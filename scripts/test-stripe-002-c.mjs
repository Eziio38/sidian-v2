#!/usr/bin/env node
/**
 * SID-STRIPE-002-C — interface minimale de paiement : champs d'affichage
 * public (resolve_payment_link_by_token_hash enrichi) et statut de retour
 * Checkout (resolve_payment_status_by_checkout_session_id).
 *
 * Lecture serveur pure uniquement — aucun nouvel invariant financier.
 */

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
const SUPABASE_URL = localConfig.url;

function localClient(key, options = {}) {
  return createClient(SUPABASE_URL, key, withLocalOnlyFetch(options));
}

const admin = localClient(LOCAL_DEMO_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const postgres = createLocalPgClient(resolveLocalPostgresUrl(), pg);
await postgres.connect();

const results = [];

function errorMessage(error) {
  return error instanceof Error
    ? error.message
    : error && typeof error === "object" && "message" in error
      ? String(error.message)
      : String(error);
}

async function run(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`✓ ${name}`);
  } catch (error) {
    results.push({ name, ok: false, message: errorMessage(error) });
    console.error(`✗ ${name}: ${errorMessage(error)}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function tokenHashOf(rawToken) {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

async function createUserAndClient(label) {
  const email = `${label}-${randomUUID()}@sidian.test`;
  const password = "Password1!";
  const { error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userError) throw userError;

  const client = localClient(LOCAL_DEMO_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) throw signInError;

  const { data: prestataire, error: prestataireError } = await client.rpc(
    "ensure_prestataire_for_current_user",
    { p_nom: `Prestataire ${label}` },
  );
  if (prestataireError || !prestataire) {
    throw prestataireError ?? new Error("prestataire absent");
  }
  return { client, prestataire };
}

async function attachStripeAccount(prestataireId) {
  const accountId = `acct_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await postgres.query(
    "update public.prestataire set stripe_account_id = $1 where id = $2",
    [accountId, prestataireId],
  );
  return accountId;
}

async function createDraft(client, montant = 12000, label = "paiement") {
  const { data: clientPayeur, error: clientError } = await client.rpc(
    "create_current_client_payeur",
    {
      p_nom: `Client ${label}`,
      p_email: `${label}-${randomUUID()}@example.com`,
      p_creation_key: randomUUID(),
    },
  );
  if (clientError || !clientPayeur) throw clientError ?? new Error("client absent");

  const { data: creance, error: creanceError } = await client.rpc(
    "create_current_creance",
    {
      p_client_payeur_id: clientPayeur.id,
      p_montant: montant,
      p_date_echeance: "2026-12-15",
      p_creation_key: randomUUID(),
      p_libelle: label,
      p_reference_externe: `REF-${label}`,
    },
  );
  if (creanceError || !creance) throw creanceError ?? new Error("créance absente");
  return { clientPayeur, creance };
}

/** Ouvre la créance et renvoie {paymentLinkId, rawToken}. */
async function openReceivableWithToken(client, creanceId) {
  const { data, error } = await client.rpc("open_payment_receivable", {
    p_creance_id: creanceId,
  });
  if (error || !data?.payment_link_id) throw error ?? new Error("ouverture KO");
  return { paymentLinkId: data.payment_link_id, rawToken: data.raw_token };
}

async function claimWebhook(type, account) {
  const eventId = `evt_${randomUUID()}`;
  const { data, error } = await admin.rpc("claim_stripe_webhook_event", {
    p_event_id: eventId,
    p_type: type,
    p_stripe_connected_account_id: account,
    p_lease_seconds: 60,
    p_max_attempts: 8,
  });
  if (error || !data?.claimed) throw error ?? new Error("claim webhook KO");
  return { eventId, leaseToken: data.lease_token, attempt: data.attempt };
}

/** Fabrique une tentative provisionnée (created) avec session + PI optionnel. */
async function provisionTentative(tenant, {
  montant = 12000,
  paymentIntentId = null,
  customerId = null,
  label = "prov",
} = {}) {
  const { creance } = await createDraft(tenant.client, montant, label);
  const account = tenant.account;
  const { paymentLinkId, rawToken } = await openReceivableWithToken(
    tenant.client,
    creance.id,
  );

  const claim = await admin.rpc("claim_checkout_provisioning", {
    p_creance_id: creance.id,
    p_payment_link_id: paymentLinkId,
    p_stripe_account_id: account,
    p_operation_key: randomUUID(),
    p_idempotency_key: `sidian_checkout_${randomUUID()}`,
    p_lease_seconds: 120,
  });
  if (claim.error || claim.data?.status !== "claimed") {
    throw claim.error ?? new Error(`claim inattendu: ${JSON.stringify(claim.data)}`);
  }
  const sessionId = `cs_test_${randomUUID().replaceAll("-", "")}`;
  const complete = await admin.rpc("complete_checkout_provisioning", {
    p_tentative_id: claim.data.tentative_id,
    p_lease_token: claim.data.lease_token,
    p_stripe_checkout_session_id: sessionId,
    p_stripe_payment_intent_id: paymentIntentId,
    p_stripe_customer_id: customerId,
    p_stripe_account_id: account,
    p_session_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    p_application_fee_amount: 0,
  });
  if (complete.error) throw complete.error;
  return {
    creance,
    account,
    rawToken,
    tentativeId: claim.data.tentative_id,
    sessionId,
  };
}

const tenantA = await createUserAndClient("s2c-a");
tenantA.account = await attachStripeAccount(tenantA.prestataire.id);

// ---------------------------------------------------------------------------
// resolve_payment_link_by_token_hash — champs d'affichage public
// ---------------------------------------------------------------------------

await run("token valide → champs d'affichage complets, aucun secret", async () => {
  const { creance } = await createDraft(tenantA.client, 25000, "display");
  const { rawToken } = await openReceivableWithToken(tenantA.client, creance.id);

  const { data, error } = await admin.rpc("resolve_payment_link_by_token_hash", {
    p_token_hash: tokenHashOf(rawToken),
  });
  if (error) throw error;
  assert(data.found === true, "lien trouvé");
  assert(data.prestataire_nom === `Prestataire s2c-a`, "nom prestataire exposé");
  assert(data.creance_libelle === "display", "libellé exposé");
  assert(data.creance_reference_externe === "REF-display", "référence exposée");
  assert(data.creance_date_echeance === "2026-12-15", "échéance exposée");
  assert(data.montant === 25000, "montant correct");
  assert(data.remaining === 25000, "solde restant correct");
  assert(data.pending_payment === false, "pas de paiement en cours");
  assert(!("token_hash" in data), "aucun hash renvoyé au client");
});

await run("token invalide (jamais émis) → found=false", async () => {
  const bogus = createHash("sha256").update(randomUUID(), "utf8").digest("hex");
  const { data, error } = await admin.rpc("resolve_payment_link_by_token_hash", {
    p_token_hash: bogus,
  });
  if (error) throw error;
  assert(data.found === false, "lien introuvable");
  assert(Object.keys(data).length === 1, "aucune fuite de champ sur échec");
});

await run("lien révoqué → found=false (jamais réactivé)", async () => {
  const { creance } = await createDraft(tenantA.client, 5000, "revoked");
  const { paymentLinkId, rawToken } = await openReceivableWithToken(
    tenantA.client,
    creance.id,
  );
  const revoke = await admin.rpc("revoke_payment_link", {
    p_payment_link_id: paymentLinkId,
  });
  if (revoke.error) throw revoke.error;

  const { data, error } = await admin.rpc("resolve_payment_link_by_token_hash", {
    p_token_hash: tokenHashOf(rawToken),
  });
  if (error) throw error;
  assert(data.found === false, "lien révoqué invisible");
});

await run("créance déjà réglée → remaining=0, creance_etat=REGLEE", async () => {
  const prov = await provisionTentative(tenantA, { montant: 8000, label: "settled" });
  const pi = `pi_${randomUUID()}`;
  const evt = await claimWebhook("payment_intent.succeeded", prov.account);
  const applied = await admin.rpc("apply_eur_payment_intent_succeeded", {
    p_stripe_event_id: evt.eventId,
    p_processing_attempt: evt.attempt,
    p_lease_token: evt.leaseToken,
    p_connected_account_id: prov.account,
    p_payment_intent_id: pi,
    p_tentative_id: prov.tentativeId,
    p_amount_received: 8000,
    p_currency: "eur",
    p_moyen: "carte",
  });
  if (applied.error) throw applied.error;
  assert(applied.data.applied === true, "paiement appliqué");

  const { data, error } = await admin.rpc("resolve_payment_link_by_token_hash", {
    p_token_hash: tokenHashOf(prov.rawToken),
  });
  if (error) throw error;
  assert(data.remaining === 0, "solde nul");
  assert(data.creance_etat === "REGLEE", "créance réglée");
});

await run("paiement en cours (SEPA EN_TRAITEMENT) → pending_payment=true", async () => {
  const prov = await provisionTentative(tenantA, { montant: 15000, label: "pending" });
  const pi = `pi_${randomUUID()}`;
  const evt = await claimWebhook("payment_intent.processing", prov.account);
  const applied = await admin.rpc("apply_payment_intent_processing", {
    p_stripe_event_id: evt.eventId,
    p_processing_attempt: evt.attempt,
    p_lease_token: evt.leaseToken,
    p_connected_account_id: prov.account,
    p_payment_intent_id: pi,
    p_tentative_id: prov.tentativeId,
    p_moyen: "sepa_core",
  });
  if (applied.error) throw applied.error;
  assert(applied.data.applied === true, "processing appliqué");

  const { data, error } = await admin.rpc("resolve_payment_link_by_token_hash", {
    p_token_hash: tokenHashOf(prov.rawToken),
  });
  if (error) throw error;
  assert(data.pending_payment === true, "paiement en cours détecté");
  assert(data.pending_moyen === "sepa_core", "moyen en cours exposé");
});

// ---------------------------------------------------------------------------
// resolve_payment_status_by_checkout_session_id — statut de retour /retour
// ---------------------------------------------------------------------------

await run("session Checkout inconnue → found=false", async () => {
  const { data, error } = await admin.rpc(
    "resolve_payment_status_by_checkout_session_id",
    { p_checkout_session_id: `cs_test_${randomUUID().replaceAll("-", "")}` },
  );
  if (error) throw error;
  assert(data.found === false, "session introuvable");
});

await run("retour avant webhook → etat CREEE, aucun identifiant interne exposé", async () => {
  const prov = await provisionTentative(tenantA, { montant: 6000, label: "before-webhook" });
  const { data, error } = await admin.rpc(
    "resolve_payment_status_by_checkout_session_id",
    { p_checkout_session_id: prov.sessionId },
  );
  if (error) throw error;
  assert(data.found === true, "session trouvée");
  assert(data.etat === "CREEE", "encore en attente de webhook");
  assert(!("creance_id" in data), "pas de creance_id exposé");
  assert(!("tentative_id" in data), "pas de tentative_id exposé");
  assert(!("prestataire_id" in data), "pas de prestataire_id exposé");
});

await run("retour après webhook réussi → etat REUSSIE", async () => {
  const prov = await provisionTentative(tenantA, { montant: 9000, label: "after-success" });
  const pi = `pi_${randomUUID()}`;
  const evt = await claimWebhook("payment_intent.succeeded", prov.account);
  const applied = await admin.rpc("apply_eur_payment_intent_succeeded", {
    p_stripe_event_id: evt.eventId,
    p_processing_attempt: evt.attempt,
    p_lease_token: evt.leaseToken,
    p_connected_account_id: prov.account,
    p_payment_intent_id: pi,
    p_tentative_id: prov.tentativeId,
    p_amount_received: 9000,
    p_currency: "eur",
    p_moyen: "carte",
  });
  if (applied.error) throw applied.error;

  const { data, error } = await admin.rpc(
    "resolve_payment_status_by_checkout_session_id",
    { p_checkout_session_id: prov.sessionId },
  );
  if (error) throw error;
  assert(data.etat === "REUSSIE", "paiement confirmé");
  assert(data.montant === 9000, "montant tentative exposé");
});

await run("retour après échec → etat ECHOUEE, code d'échec exposé", async () => {
  const prov = await provisionTentative(tenantA, { montant: 4000, label: "after-failed" });
  const pi = `pi_${randomUUID()}`;
  const evt = await claimWebhook("payment_intent.payment_failed", prov.account);
  const applied = await admin.rpc("apply_payment_intent_payment_failed", {
    p_stripe_event_id: evt.eventId,
    p_processing_attempt: evt.attempt,
    p_lease_token: evt.leaseToken,
    p_connected_account_id: prov.account,
    p_payment_intent_id: pi,
    p_tentative_id: prov.tentativeId,
    p_echec_code: "card_declined",
    p_echec_message: "Carte refusée.",
  });
  if (applied.error) throw applied.error;

  const { data, error } = await admin.rpc(
    "resolve_payment_status_by_checkout_session_id",
    { p_checkout_session_id: prov.sessionId },
  );
  if (error) throw error;
  assert(data.etat === "ECHOUEE", "paiement non confirmé");
  assert(data.echec_code === "card_declined", "code d'échec exposé");
});

await run("annulation (session expirée) → etat ANNULEE, aucun changement financier", async () => {
  const prov = await provisionTentative(tenantA, { montant: 7000, label: "cancel" });
  const evt = await claimWebhook("checkout.session.expired", prov.account);
  const applied = await admin.rpc("apply_checkout_session_expired_payment", {
    p_stripe_event_id: evt.eventId,
    p_processing_attempt: evt.attempt,
    p_lease_token: evt.leaseToken,
    p_connected_account_id: prov.account,
    p_checkout_session_id: prov.sessionId,
  });
  if (applied.error) throw applied.error;

  const { data, error } = await admin.rpc(
    "resolve_payment_status_by_checkout_session_id",
    { p_checkout_session_id: prov.sessionId },
  );
  if (error) throw error;
  assert(data.etat === "ANNULEE", "annulation reflétée");

  const { rows: pmt } = await postgres.query(
    "select count(*)::int as n from public.paiement where creance_id = $1",
    [prov.creance.id],
  );
  assert(pmt[0].n === 0, "aucun paiement créé par une annulation");
});

await run("identifiant vide → rejet fermé sans scan", async () => {
  const { data, error } = await admin.rpc(
    "resolve_payment_status_by_checkout_session_id",
    { p_checkout_session_id: "   " },
  );
  assert(!error, "RPC service_role ne doit pas échouer sur entrée invalide");
  assert(data?.found === false, "identifiant vide → found=false");
});

await run("ACL public : anon et authenticated n'ont aucun accès direct", async () => {
  const anon = localClient(LOCAL_DEMO_ANON_KEY);
  const link = await anon.rpc("resolve_payment_link_by_token_hash", {
    p_token_hash: "0".repeat(64),
  });
  assert(Boolean(link.error), "anon refusé sur resolve_payment_link_by_token_hash");
  const status = await anon.rpc("resolve_payment_status_by_checkout_session_id", {
    p_checkout_session_id: "cs_test_x",
  });
  assert(
    Boolean(status.error),
    "anon refusé sur resolve_payment_status_by_checkout_session_id",
  );

  const asUser = await tenantA.client.rpc(
    "resolve_payment_status_by_checkout_session_id",
    { p_checkout_session_id: "cs_test_x" },
  );
  assert(
    Boolean(asUser.error),
    "authenticated refusé sur resolve_payment_status_by_checkout_session_id",
  );
});

await postgres.end();

const failures = results.filter((result) => !result.ok);
console.log(
  `\nSID-STRIPE-002-C: ${results.length - failures.length}/${results.length} tests réussis.`,
);
if (failures.length > 0) process.exitCode = 1;
