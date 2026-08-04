#!/usr/bin/env node
/**
 * SID-BILLING-001 — cycle de vie de l'abonnement Sidian contre une base réelle.
 *
 * Les tests vitest couvrent la traduction des événements Stripe. Ce harnais
 * vérifie ce que le SQL garantit vraiment : transitions, idempotence,
 * résistance au hors-ordre, audit, et surtout l'impossibilité pour un
 * utilisateur authentifié d'écrire lui-même son statut d'abonnement.
 */

import { createClient } from "@supabase/supabase-js";

import {
  assertLocalTestConfig,
  LOCAL_DEMO_ANON_KEY,
  LOCAL_DEMO_SERVICE_ROLE_KEY,
} from "./lib/assert-local-supabase.mjs";
import { withLocalOnlyFetch } from "./lib/local-only-fetch.mjs";

const localConfig = assertLocalTestConfig();

function localClient(key, options = {}) {
  return createClient(
    localConfig.url,
    key,
    withLocalOnlyFetch({
      auth: { autoRefreshToken: false, persistSession: false },
      ...options,
    }),
  );
}

const admin = localClient(LOCAL_DEMO_SERVICE_ROLE_KEY);

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`✓ ${message}`);
}

async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

async function rpcExpectError(client, name, args) {
  const { error } = await client.rpc(name, args);
  return error;
}

async function insertOne(table, values, columns = "id") {
  const { data, error } = await admin
    .from(table)
    .insert(values)
    .select(columns)
    .single();
  if (error || !data) throw error ?? new Error(`${table}_insert_failed`);
  return data;
}

async function readPrestataire(id) {
  const { data, error } = await admin
    .from("prestataire")
    .select(
      "id, subscription_status, subscription_started_at, early_access_price_locked_until, pricing_version",
    )
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

async function readSubscription(prestataireId) {
  const { data, error } = await admin
    .from("sidian_subscription")
    .select("*")
    .eq("prestataire_id", prestataireId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function auditActions(prestataireId) {
  const { data, error } = await admin
    .from("audit_log")
    .select("action, metadata, actor_type, actor_provider")
    .eq("prestataire_id", prestataireId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

const iso = (offsetSeconds = 0) =>
  new Date(Date.parse("2026-08-03T10:00:00.000Z") + offsetSeconds * 1000)
    .toISOString();

async function main() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const password = "BillingTest123!";
  const email = `billing-${suffix}@sidian.test`;

  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userError) throw userError;

  const prestataire = await insertOne("prestataire", {
    user_id: userData.user.id,
    nom: "Billing",
    email,
  });

  const customerId = `cus_test_${suffix}`;
  const subscriptionId = `sub_test_${suffix}`;

  // ── Binding du Customer plateforme ────────────────────────────────────────
  const bound = await rpc(admin, "bind_sidian_subscription_customer", {
    p_prestataire_id: prestataire.id,
    p_stripe_customer_id: customerId,
  });
  check(
    bound.prestataire_id === prestataire.id &&
      bound.stripe_customer_id === customerId,
    "le binding lie le prestataire à son Customer de facturation",
  );

  const rebound = await rpc(admin, "bind_sidian_subscription_customer", {
    p_prestataire_id: prestataire.id,
    p_stripe_customer_id: customerId,
  });
  check(
    rebound.stripe_customer_id === customerId,
    "le binding est idempotent",
  );

  const conflict = await rpcExpectError(
    admin,
    "bind_sidian_subscription_customer",
    {
      p_prestataire_id: prestataire.id,
      p_stripe_customer_id: `cus_other_${suffix}`,
    },
  );
  check(
    conflict?.message.includes("billing_customer_binding_conflict"),
    "un prestataire ne bascule pas silencieusement vers un autre Customer",
  );

  const otherUser = await admin.auth.admin.createUser({
    email: `billing-other-${suffix}@sidian.test`,
    password,
    email_confirm: true,
  });
  if (otherUser.error) throw otherUser.error;
  const otherPrestataire = await insertOne("prestataire", {
    user_id: otherUser.data.user.id,
    nom: "Billing autre",
    email: `billing-other-${suffix}@sidian.test`,
  });
  const stolen = await rpcExpectError(
    admin,
    "bind_sidian_subscription_customer",
    {
      p_prestataire_id: otherPrestataire.id,
      p_stripe_customer_id: customerId,
    },
  );
  check(
    stolen?.message.includes("billing_customer_bound_elsewhere"),
    "un Customer déjà lié ne peut pas être capté par un autre prestataire",
  );

  // ── Projection des statuts Stripe ────────────────────────────────────────
  const mapping = {
    trialing: "trialing",
    active: "active",
    past_due: "past_due",
    unpaid: "past_due",
    paused: "past_due",
    incomplete: "past_due",
    incomplete_expired: "cancelled",
    canceled: "cancelled",
    inconnu: "past_due",
  };
  for (const [stripeStatus, expected] of Object.entries(mapping)) {
    const mapped = await rpc(admin, "map_stripe_subscription_status", {
      p_stripe_status: stripeStatus,
    });
    check(
      mapped === expected,
      `map_stripe_subscription_status(${stripeStatus}) = ${expected}`,
    );
  }

  // ── created → active ─────────────────────────────────────────────────────
  const created = await rpc(admin, "apply_sidian_subscription_event", {
    p_stripe_event_id: `evt_created_${suffix}`,
    p_event_type: "customer.subscription.created",
    p_event_created_at: iso(0),
    p_stripe_customer_id: customerId,
    p_stripe_subscription_id: subscriptionId,
    p_stripe_status: "active",
    p_stripe_price_id: "price_early_access",
    p_current_period_end: iso(2_592_000),
    p_cancel_at_period_end: false,
    p_early_access_lock_months: 12,
  });
  check(
    created.applied === true && created.subscription_status === "active",
    "customer.subscription.created active l'abonnement",
  );

  let row = await readPrestataire(prestataire.id);
  check(
    row.subscription_status === "active",
    "prestataire.subscription_status passe à active",
  );
  check(
    row.subscription_started_at !== null,
    "subscription_started_at est horodaté à la première activation",
  );
  check(
    row.early_access_price_locked_until !== null,
    "le verrouillage tarifaire est écrit quand une durée est configurée",
  );
  check(
    row.pricing_version === "early_solo",
    "pricing_version n'est jamais réécrit par le webhook",
  );

  let sub = await readSubscription(prestataire.id);
  check(
    sub.stripe_subscription_id === subscriptionId &&
      sub.stripe_status === "active" &&
      sub.stripe_price_id === "price_early_access",
    "la projection d'abonnement est enregistrée",
  );

  // ── Idempotence ──────────────────────────────────────────────────────────
  const replay = await rpc(admin, "apply_sidian_subscription_event", {
    p_stripe_event_id: `evt_created_${suffix}`,
    p_event_type: "customer.subscription.created",
    p_event_created_at: iso(0),
    p_stripe_customer_id: customerId,
    p_stripe_subscription_id: subscriptionId,
    p_stripe_status: "canceled",
    p_early_access_lock_months: 12,
  });
  check(
    replay.applied === false && replay.reason === "already_applied",
    "le rejeu du même event_id n'applique rien",
  );
  row = await readPrestataire(prestataire.id);
  check(
    row.subscription_status === "active",
    "le rejeu ne modifie pas le statut malgré une charge utile différente",
  );

  // ── Hors-ordre ───────────────────────────────────────────────────────────
  const recent = await rpc(admin, "apply_sidian_subscription_event", {
    p_stripe_event_id: `evt_recent_${suffix}`,
    p_event_type: "customer.subscription.updated",
    p_event_created_at: iso(600),
    p_stripe_customer_id: customerId,
    p_stripe_subscription_id: subscriptionId,
    p_stripe_status: "past_due",
  });
  check(
    recent.applied === true && recent.subscription_status === "past_due",
    "un événement plus récent applique bien past_due",
  );

  const stale = await rpc(admin, "apply_sidian_subscription_event", {
    p_stripe_event_id: `evt_stale_${suffix}`,
    p_event_type: "customer.subscription.updated",
    p_event_created_at: iso(300),
    p_stripe_customer_id: customerId,
    p_stripe_subscription_id: subscriptionId,
    p_stripe_status: "active",
  });
  check(
    stale.applied === false && stale.reason === "stale_event",
    "un événement plus ancien est ignoré",
  );
  row = await readPrestataire(prestataire.id);
  check(
    row.subscription_status === "past_due",
    "le hors-ordre ne réécrit pas le statut courant",
  );

  // ── Identité d'abonnement ────────────────────────────────────────────────
  const mismatch = await rpcExpectError(
    admin,
    "apply_sidian_subscription_event",
    {
      p_stripe_event_id: `evt_mismatch_${suffix}`,
      p_event_type: "customer.subscription.updated",
      p_event_created_at: iso(900),
      p_stripe_customer_id: customerId,
      p_stripe_subscription_id: `sub_autre_${suffix}`,
      p_stripe_status: "active",
    },
  );
  check(
    mismatch?.message.includes("billing_subscription_identity_mismatch"),
    "un second abonnement sur le même Customer est refusé",
  );

  // ── Customer inconnu ─────────────────────────────────────────────────────
  const orphan = await rpc(admin, "apply_sidian_subscription_event", {
    p_stripe_event_id: `evt_orphan_${suffix}`,
    p_event_type: "customer.subscription.updated",
    p_event_created_at: iso(0),
    p_stripe_customer_id: `cus_inconnu_${suffix}`,
    p_stripe_subscription_id: `sub_inconnu_${suffix}`,
    p_stripe_status: "active",
  });
  check(
    orphan.applied === false && orphan.reason === "no_binding_for_customer",
    "un Customer sans binding n'invente aucun compte",
  );

  // ── Type d'événement hors périmètre ──────────────────────────────────────
  const unsupported = await rpcExpectError(
    admin,
    "apply_sidian_subscription_event",
    {
      p_stripe_event_id: `evt_bad_${suffix}`,
      p_event_type: "customer.subscription.trial_will_end",
      p_event_created_at: iso(0),
      p_stripe_customer_id: customerId,
      p_stripe_subscription_id: subscriptionId,
      p_stripe_status: "active",
    },
  );
  check(
    unsupported?.message.includes("billing_event_type_unsupported"),
    "un type d'événement non supporté est refusé",
  );

  // ── Échec de prélèvement ─────────────────────────────────────────────────
  const backToActive = await rpc(admin, "apply_sidian_subscription_event", {
    p_stripe_event_id: `evt_active_${suffix}`,
    p_event_type: "customer.subscription.updated",
    p_event_created_at: iso(1_200),
    p_stripe_customer_id: customerId,
    p_stripe_subscription_id: subscriptionId,
    p_stripe_status: "active",
  });
  check(backToActive.applied === true, "l'abonnement peut redevenir actif");

  const failure = await rpc(
    admin,
    "apply_sidian_subscription_payment_failure",
    {
      p_stripe_event_id: `evt_fail_${suffix}`,
      p_event_created_at: iso(1_500),
      p_stripe_customer_id: customerId,
      p_stripe_invoice_id: `in_${suffix}`,
      p_stripe_subscription_id: subscriptionId,
    },
  );
  check(
    failure.applied === true && failure.subscription_status === "past_due",
    "invoice.payment_failed dégrade un compte actif en past_due",
  );

  const failureReplay = await rpc(
    admin,
    "apply_sidian_subscription_payment_failure",
    {
      p_stripe_event_id: `evt_fail_${suffix}`,
      p_event_created_at: iso(1_500),
      p_stripe_customer_id: customerId,
      p_stripe_invoice_id: `in_${suffix}`,
      p_stripe_subscription_id: subscriptionId,
    },
  );
  check(
    failureReplay.applied === false &&
      failureReplay.reason === "already_applied",
    "le rejeu d'un échec de prélèvement est neutre",
  );

  sub = await readSubscription(prestataire.id);
  check(
    sub.last_payment_failed_at !== null,
    "l'échec de prélèvement est horodaté",
  );
  check(
    Date.parse(sub.last_subscription_event_at) === Date.parse(iso(1_200)),
    "invoice.payment_failed ne fait pas écran au cycle de vie",
  );

  // Un échec ANTÉRIEUR au dernier événement de cycle de vie ne dégrade rien.
  const lateActive = await rpc(admin, "apply_sidian_subscription_event", {
    p_stripe_event_id: `evt_active2_${suffix}`,
    p_event_type: "customer.subscription.updated",
    p_event_created_at: iso(1_800),
    p_stripe_customer_id: customerId,
    p_stripe_subscription_id: subscriptionId,
    p_stripe_status: "active",
  });
  check(lateActive.subscription_status === "active", "récupération après échec");

  const oldFailure = await rpc(
    admin,
    "apply_sidian_subscription_payment_failure",
    {
      p_stripe_event_id: `evt_fail_old_${suffix}`,
      p_event_created_at: iso(1_600),
      p_stripe_customer_id: customerId,
      p_stripe_invoice_id: `in_old_${suffix}`,
      p_stripe_subscription_id: subscriptionId,
    },
  );
  check(
    oldFailure.applied === true && oldFailure.subscription_status === "active",
    "un échec antérieur au dernier événement de cycle de vie ne dégrade pas",
  );

  // ── Résiliation ──────────────────────────────────────────────────────────
  const deleted = await rpc(admin, "apply_sidian_subscription_event", {
    p_stripe_event_id: `evt_deleted_${suffix}`,
    p_event_type: "customer.subscription.deleted",
    p_event_created_at: iso(2_400),
    p_stripe_customer_id: customerId,
    p_stripe_subscription_id: subscriptionId,
    // Statut incohérent volontaire : deleted doit faire foi.
    p_stripe_status: "active",
  });
  check(
    deleted.applied === true && deleted.subscription_status === "cancelled",
    "customer.subscription.deleted force cancelled quel que soit le statut porté",
  );
  sub = await readSubscription(prestataire.id);
  check(
    sub.stripe_status === "canceled",
    "le statut brut Stripe reflète la résiliation",
  );

  const failAfterCancel = await rpc(
    admin,
    "apply_sidian_subscription_payment_failure",
    {
      p_stripe_event_id: `evt_fail2_${suffix}`,
      p_event_created_at: iso(3_000),
      p_stripe_customer_id: customerId,
      p_stripe_invoice_id: `in2_${suffix}`,
      p_stripe_subscription_id: subscriptionId,
    },
  );
  check(
    failAfterCancel.subscription_status === "cancelled",
    "un échec de prélèvement ne ressuscite pas un compte résilié",
  );

  // ── Audit ────────────────────────────────────────────────────────────────
  const audits = await auditActions(prestataire.id);
  const actions = audits.map((entry) => entry.action);
  check(
    actions.includes("billing.subscription.created") &&
      actions.includes("billing.subscription.updated") &&
      actions.includes("billing.subscription.deleted") &&
      actions.includes("billing.subscription.payment_failed"),
    "chaque transition laisse une trace dans audit_log",
  );
  check(
    audits.every(
      (entry) =>
        entry.actor_type === "system" && entry.actor_provider === "stripe",
    ),
    "les traces d'abonnement sont attribuées au système Stripe",
  );
  const createdAudit = audits.find(
    (entry) => entry.action === "billing.subscription.created",
  );
  check(
    createdAudit.metadata.previous_subscription_status === "trialing" &&
      createdAudit.metadata.subscription_status === "active",
    "la trace conserve la transition exacte",
  );

  // ── Garde-fou : aucune écriture par un utilisateur authentifié ───────────
  const { data: session, error: signInError } = await localClient(
    LOCAL_DEMO_ANON_KEY,
  ).auth.signInWithPassword({ email, password });
  if (signInError || !session.session) {
    throw signInError ?? new Error("sign_in_failed");
  }
  const asUser = localClient(LOCAL_DEMO_ANON_KEY, {
    global: {
      headers: { Authorization: `Bearer ${session.session.access_token}` },
    },
  });

  const selfPromotion = await asUser
    .from("prestataire")
    .update({ subscription_status: "active" })
    .eq("id", prestataire.id);
  check(
    selfPromotion.error !== null,
    "un utilisateur authentifié ne peut pas écrire son subscription_status",
  );

  const selfLock = await asUser
    .from("prestataire")
    .update({ early_access_price_locked_until: "2099-01-01T00:00:00Z" })
    .eq("id", prestataire.id);
  check(
    selfLock.error !== null,
    "un utilisateur authentifié ne peut pas s'octroyer un verrouillage tarifaire",
  );

  const readOwn = await asUser
    .from("sidian_subscription")
    .select("stripe_customer_id, stripe_status")
    .eq("prestataire_id", prestataire.id);
  check(
    readOwn.error === null && readOwn.data.length === 1,
    "le prestataire lit son propre abonnement",
  );

  const readOther = await asUser
    .from("sidian_subscription")
    .select("stripe_customer_id")
    .eq("prestataire_id", otherPrestataire.id);
  check(
    readOther.error === null && readOther.data.length === 0,
    "le prestataire ne lit pas l'abonnement d'un autre compte",
  );

  const writeOwn = await asUser
    .from("sidian_subscription")
    .update({ stripe_status: "active" })
    .eq("prestataire_id", prestataire.id);
  check(
    writeOwn.error !== null,
    "un utilisateur authentifié ne peut pas écrire dans sidian_subscription",
  );

  const insertOwn = await asUser.from("sidian_subscription").insert({
    prestataire_id: prestataire.id,
    stripe_customer_id: `cus_forge_${suffix}`,
  });
  check(
    insertOwn.error !== null,
    "un utilisateur authentifié ne peut pas forger un abonnement",
  );

  for (const name of [
    "apply_sidian_subscription_event",
    "apply_sidian_subscription_payment_failure",
    "bind_sidian_subscription_customer",
  ]) {
    const denied = await rpcExpectError(asUser, name, {});
    check(
      denied !== null,
      `${name} n'est pas exécutable par un utilisateur authentifié`,
    );
  }

  const anon = localClient(LOCAL_DEMO_ANON_KEY);
  const anonDenied = await rpcExpectError(
    anon,
    "apply_sidian_subscription_event",
    {},
  );
  check(anonDenied !== null, "les RPC d'abonnement sont fermées à anon");

  const anonRead = await anon.from("sidian_subscription").select("*");
  check(
    anonRead.error !== null || anonRead.data.length === 0,
    "anon ne lit aucun abonnement",
  );

  console.log(`\n${passed} vérifications réussies.`);
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  process.exitCode = 1;
});
