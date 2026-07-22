#!/usr/bin/env node
/** SID-PROD-004 — réconciliation Stripe live (Supabase local uniquement). */

import { createHash, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import pg from "pg";

import {
  assertLocalTestConfig,
  LOCAL_DEMO_ANON_KEY,
  LOCAL_DEMO_SERVICE_ROLE_KEY,
} from "./lib/assert-local-supabase.mjs";
import {
  createLocalPgClient,
  resolveLocalPostgresUrl,
} from "./lib/assert-local-postgres.mjs";
import { withLocalOnlyFetch } from "./lib/local-only-fetch.mjs";

const localConfig = assertLocalTestConfig();
const postgres = createLocalPgClient(resolveLocalPostgresUrl(), pg);

function localClient(key, options = {}) {
  return createClient(localConfig.url, key, withLocalOnlyFetch(options));
}

const admin = localClient(LOCAL_DEMO_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const results = [];
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
async function run(name, test) {
  try {
    await test();
    results.push({ ok: true, name });
    console.log(`✓ ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ ok: false, name, message });
    console.error(`✗ ${name}: ${message}`);
  }
}

async function createTenant(label) {
  const email = `prod-004-${label}-${randomUUID()}@sidian.test`;
  const password = "Prod004-Local-Password1!";
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) throw created.error;

  const auth = localClient(LOCAL_DEMO_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signed = await auth.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) throw signed.error;
  const client = localClient(LOCAL_DEMO_ANON_KEY, {
    global: {
      headers: { Authorization: `Bearer ${signed.data.session.access_token}` },
    },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const ensured = await client.rpc("ensure_prestataire_for_current_user", {
    p_nom: `Agence ${label}`,
  });
  if (ensured.error || !ensured.data) throw ensured.error;
  const accountId = `acct_prod004_${label}_${randomUUID().replaceAll("-", "")}`;
  const projected = await admin
    .from("prestataire")
    .update({ stripe_account_id: accountId })
    .eq("id", ensured.data.id);
  if (projected.error) throw projected.error;
  return {
    client,
    userId: created.data.user.id,
    prestataireId: ensured.data.id,
    accountId,
  };
}

async function createReceivableAttempt(tenant, label) {
  const amount = 12_500;
  const payeur = await tenant.client.rpc("create_current_client_payeur", {
    p_nom: `Client ${label}`,
    p_email: `${label}-${randomUUID()}@example.com`,
    p_creation_key: randomUUID(),
  });
  if (payeur.error || !payeur.data) throw payeur.error;
  const creance = await tenant.client.rpc("create_current_creance", {
    p_client_payeur_id: payeur.data.id,
    p_montant: amount,
    p_date_echeance: "2099-12-15",
    p_creation_key: randomUUID(),
    p_libelle: label,
    p_reference_externe: null,
    p_devise: "EUR",
  });
  if (creance.error || !creance.data) throw creance.error;
  const opened = await tenant.client.rpc("open_payment_receivable", {
    p_creance_id: creance.data.id,
  });
  if (opened.error) throw opened.error;

  const suffix = randomUUID().replaceAll("-", "");
  const technical = {
    sessionId: `cs_prod004_${suffix}`,
    paymentIntentId: `pi_prod004_${suffix}`,
    customerId: `cus_prod004_${suffix}`,
  };
  const inserted = await admin
    .from("tentative_paiement")
    .insert({
      creance_id: creance.data.id,
      montant: amount,
      moyen: "carte",
      source: "lien_agent",
      etat: "CREEE",
      stripe_account_id: tenant.accountId,
      stripe_checkout_session_id: technical.sessionId,
      stripe_payment_intent_id: technical.paymentIntentId,
      stripe_customer_id: technical.customerId,
      checkout_provisioning_status: "created",
      checkout_provisioning_attempts: 1,
      application_fee_amount: 0,
    })
    .select("id")
    .single();
  if (inserted.error || !inserted.data) throw inserted.error;
  return {
    amount,
    clientPayeurId: payeur.data.id,
    creanceId: creance.data.id,
    tentativeId: inserted.data.id,
    ...technical,
  };
}

function observation(tenant, attempt, overrides = {}) {
  return {
    account_id: tenant.accountId,
    account_metadata_prestataire_id: tenant.prestataireId,
    account_metadata_environment: "local",
    session_id: attempt.sessionId,
    session_mode: "payment",
    session_status: "complete",
    session_payment_status: "paid",
    session_currency: "eur",
    session_amount_total: attempt.amount,
    session_client_reference_id: attempt.tentativeId,
    session_metadata_tentative_id: attempt.tentativeId,
    session_metadata_creance_id: attempt.creanceId,
    session_payment_intent_id: attempt.paymentIntentId,
    session_customer_id: attempt.customerId,
    payment_intent_id: attempt.paymentIntentId,
    payment_intent_status: "succeeded",
    payment_intent_currency: "eur",
    payment_intent_amount: attempt.amount,
    payment_intent_amount_received: attempt.amount,
    payment_intent_application_fee_amount: 0,
    payment_intent_customer_id: attempt.customerId,
    payment_intent_metadata_tentative_id: attempt.tentativeId,
    payment_intent_metadata_creance_id: attempt.creanceId,
    customer_id: attempt.customerId,
    customer_deleted: false,
    customer_metadata_prestataire_id: tenant.prestataireId,
    customer_metadata_client_payeur_id: attempt.clientPayeurId,
    customer_metadata_environment: "local",
    moyen: "carte",
    ...overrides,
  };
}

async function applySucceeded(tenant, attempt, live = observation(tenant, attempt)) {
  return admin.rpc("apply_safe_eur_payment_reconciliation", {
    p_requester_user_id: tenant.userId,
    p_creance_id: attempt.creanceId,
    p_tentative_id: attempt.tentativeId,
    p_effect_type: "payment_intent.succeeded",
    p_sidian_environment: "local",
    p_observation: live,
  });
}

async function count(table, filters) {
  let query = admin.from(table).select("*", { count: "exact", head: true });
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const response = await query;
  if (response.error) throw response.error;
  return response.count ?? 0;
}

await postgres.connect();
const tenantA = await createTenant("A");
const tenantB = await createTenant("B");

await run("RPC fencées : SECURITY DEFINER, search_path et ACL service-only", async () => {
  const names = [
    "apply_safe_eur_payment_reconciliation",
    "register_payment_reconciliation_human_required",
  ];
  const inspected = await postgres.query(
    `select p.proname, p.prosecdef, p.proconfig,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any($1::text[])`,
    [names],
  );
  assert(inspected.rowCount === names.length, "RPC de réconciliation manquante");
  for (const row of inspected.rows) {
    assert(row.prosecdef === true, `${row.proname}: SECURITY DEFINER absent`);
    assert(
      (row.proconfig ?? []).includes("search_path=pg_catalog, public, pg_temp"),
      `${row.proname}: search_path absent`,
    );
    assert(!row.auth_execute && !row.anon_execute, `${row.proname}: surface navigateur`);
    assert(row.service_execute, `${row.proname}: service_role absent`);
  }
});

await run("succès EUR strict : paiement créé via primitive existante et fence namespacé", async () => {
  const attempt = await createReceivableAttempt(tenantA, "success");
  const response = await applySucceeded(tenantA, attempt);
  if (response.error || !response.data) throw response.error;
  assert(response.data.outcome === "repaired", "succès non rapproché");

  const [tentative, creance] = await Promise.all([
    admin.from("tentative_paiement").select("etat").eq("id", attempt.tentativeId).single(),
    admin.from("creance").select("etat").eq("id", attempt.creanceId).single(),
  ]);
  if (tentative.error || creance.error) throw tentative.error ?? creance.error;
  assert(tentative.data.etat === "REUSSIE", "tentative non réussie");
  assert(creance.data.etat === "REGLEE", "créance non réglée");
  assert(
    (await count("paiement", { tentative_paiement_id: attempt.tentativeId })) === 1,
    "paiement confirmé absent",
  );
  const fences = await admin
    .from("processed_webhook_event")
    .select("id, processing_status")
    .like("id", "reconciliation:%")
    .eq("type", "payment_intent.succeeded");
  if (fences.error) throw fences.error;
  assert(fences.data.some((row) => row.processing_status === "processed"), "fence absent");
  assert(fences.data.every((row) => !row.id.startsWith("evt_")), "faux evt_* créé");
});

await run("replay identique : aucun paiement ni audit de réparation dupliqué", async () => {
  const attempt = await createReceivableAttempt(tenantA, "replay");
  const first = await applySucceeded(tenantA, attempt);
  const replay = await applySucceeded(tenantA, attempt);
  if (first.error || replay.error) throw first.error ?? replay.error;
  assert(first.data.outcome === "repaired", "premier passage non réparé");
  assert(replay.data.outcome === "up_to_date", "replay non idempotent");
  assert(
    (await count("paiement", { tentative_paiement_id: attempt.tentativeId })) === 1,
    "paiement dupliqué au replay",
  );
  assert(
    (await count("audit_log", {
      entity_id: attempt.creanceId,
      action: "PAYMENT_RECONCILIATION_REPAIR_APPLIED",
    })) === 1,
    "audit de réparation dupliqué",
  );
});

await run("concurrence : un seul effet financier et un seul audit", async () => {
  const attempt = await createReceivableAttempt(tenantA, "concurrency");
  const responses = await Promise.all([
    applySucceeded(tenantA, attempt),
    applySucceeded(tenantA, attempt),
  ]);
  for (const response of responses) if (response.error) throw response.error;
  const outcomes = responses.map((response) => response.data.outcome).sort();
  assert(
    JSON.stringify(outcomes) === JSON.stringify(["repaired", "up_to_date"]),
    `résultats concurrence inattendus: ${outcomes.join(",")}`,
  );
  assert(
    (await count("paiement", { tentative_paiement_id: attempt.tentativeId })) === 1,
    "effet financier concurrent dupliqué",
  );
});

await run("scope : un autre prestataire ne peut pas rapprocher la ressource", async () => {
  const attempt = await createReceivableAttempt(tenantA, "scope");
  const response = await admin.rpc("apply_safe_eur_payment_reconciliation", {
    p_requester_user_id: tenantB.userId,
    p_creance_id: attempt.creanceId,
    p_tentative_id: attempt.tentativeId,
    p_effect_type: "payment_intent.succeeded",
    p_sidian_environment: "local",
    p_observation: observation(tenantA, attempt),
  });
  assert(Boolean(response.error), "scope croisé accepté");
  assert(
    (await count("paiement", { tentative_paiement_id: attempt.tentativeId })) === 0,
    "paiement créé malgré le refus de scope",
  );
});

await run("devise Stripe non EUR : rejet sans paiement ni créance modifiée", async () => {
  const attempt = await createReceivableAttempt(tenantA, "currency");
  const response = await applySucceeded(
    tenantA,
    attempt,
    observation(tenantA, attempt, {
      session_currency: "usd",
      payment_intent_currency: "usd",
    }),
  );
  assert(Boolean(response.error), "devise non EUR acceptée");
  assert(
    (await count("paiement", { tentative_paiement_id: attempt.tentativeId })) === 0,
    "paiement créé en devise non EUR",
  );
  const creance = await admin.from("creance").select("etat").eq("id", attempt.creanceId).single();
  if (creance.error) throw creance.error;
  assert(creance.data.etat === "OUVERTE", "créance modifiée après rejet devise");
});

await run("cas humain : audit + approval dédupliqués, sans effet financier", async () => {
  const attempt = await createReceivableAttempt(tenantA, "human");
  const key = createHash("sha256")
    .update(`human:${attempt.creanceId}:${attempt.tentativeId}`)
    .digest("hex");
  const args = {
    p_requester_user_id: tenantA.userId,
    p_creance_id: attempt.creanceId,
    p_tentative_id: attempt.tentativeId,
    p_reconciliation_key: key,
    p_reason: "customer_identity_mismatch",
  };
  const first = await admin.rpc("register_payment_reconciliation_human_required", args);
  const replay = await admin.rpc("register_payment_reconciliation_human_required", args);
  if (first.error || replay.error) throw first.error ?? replay.error;
  assert(first.data.created === true && replay.data.created === false, "garde-fou non idempotent");
  assert((await count("payment_reconciliation_issue", { reconciliation_key: key })) === 1, "issue dupliquée");
  assert(
    (await count("approval_request", { creance_id: attempt.creanceId, status: "pending" })) === 1,
    "approval absente ou dupliquée",
  );
  assert(
    (await count("audit_log", {
      entity_id: attempt.creanceId,
      action: "PAYMENT_RECONCILIATION_HUMAN_REQUIRED",
    })) === 1,
    "audit humain absent ou dupliqué",
  );
  assert(
    (await count("paiement", { tentative_paiement_id: attempt.tentativeId })) === 0,
    "cas ambigu a produit un paiement",
  );
});

await run("navigateur : aucune RPC service-only ni écriture du registre", async () => {
  const attempt = await createReceivableAttempt(tenantA, "browser");
  const direct = await tenantA.client.rpc("apply_safe_eur_payment_reconciliation", {
    p_requester_user_id: tenantA.userId,
    p_creance_id: attempt.creanceId,
    p_tentative_id: attempt.tentativeId,
    p_effect_type: "payment_intent.succeeded",
    p_sidian_environment: "local",
    p_observation: observation(tenantA, attempt),
  });
  assert(Boolean(direct.error), "RPC financière accessible au navigateur");
  const insert = await tenantA.client.from("payment_reconciliation_issue").insert({
    prestataire_id: tenantA.prestataireId,
    creance_id: attempt.creanceId,
    tentative_paiement_id: attempt.tentativeId,
    reconciliation_key: "a".repeat(64),
    reason: "stripe_object_missing",
  });
  assert(Boolean(insert.error), "registre ambigu insérable par le navigateur");
});

await run("dossier CLOS : la réconciliation financière ne le rouvre jamais", async () => {
  const attempt = await createReceivableAttempt(tenantA, "closed-case");
  const dossier = await admin
    .from("dossier_suivi")
    .insert({ creance_id: attempt.creanceId, etat: "CLOS", clos_at: new Date().toISOString() })
    .select("id")
    .single();
  if (dossier.error) throw dossier.error;
  const response = await applySucceeded(tenantA, attempt);
  if (response.error) throw response.error;
  const after = await admin.from("dossier_suivi").select("etat, clos_at").eq("id", dossier.data.id).single();
  if (after.error) throw after.error;
  assert(after.data.etat === "CLOS" && after.data.clos_at !== null, "dossier CLOS rouvert");
});

const failed = results.filter((result) => !result.ok);
console.log(`\nSID-PROD-004: ${results.length - failed.length}/${results.length} tests réussis.`);
await postgres.end();
if (failed.length > 0) process.exitCode = 1;
