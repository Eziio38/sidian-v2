#!/usr/bin/env node
/**
 * SID-STRIPE-002-B — provisioning Checkout (claim/lease/reprise) et effets
 * financiers webhook fencés (paiement, recalcul créance, trop-perçu).
 *
 * Chemin PAIEMENT uniquement. Le chemin autorisation future (setup) est différé.
 */

import { randomUUID } from "node:crypto";
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
    },
  );
  if (creanceError || !creance) throw creanceError ?? new Error("créance absente");
  return { clientPayeur, creance };
}

/** Provisionne un compte connecté fictif sur le prestataire (bypass superuser). */
async function attachStripeAccount(prestataireId) {
  const accountId = `acct_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await postgres.query(
    "update public.prestataire set stripe_account_id = $1 where id = $2",
    [accountId, prestataireId],
  );
  return accountId;
}

/** Ouvre la créance et renvoie le payment_link_id actif. */
async function openReceivable(client, creanceId) {
  const { data, error } = await client.rpc("open_payment_receivable", {
    p_creance_id: creanceId,
  });
  if (error || !data?.payment_link_id) throw error ?? new Error("ouverture KO");
  return data.payment_link_id;
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
} = {}) {
  const { creance } = await createDraft(tenant.client, montant, "prov");
  const account = tenant.account;
  const linkId = await openReceivable(tenant.client, creance.id);

  const claim = await admin.rpc("claim_checkout_provisioning", {
    p_creance_id: creance.id,
    p_payment_link_id: linkId,
    p_stripe_account_id: account,
    p_operation_key: randomUUID(),
    p_idempotency_key: `sidian_checkout_${randomUUID()}`,
    p_lease_seconds: 120,
  });
  if (claim.error || claim.data?.status !== "claimed") {
    throw claim.error ?? new Error(`claim inattendu: ${JSON.stringify(claim.data)}`);
  }
  const sessionId = `cs_test_${randomUUID()}`;
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
    linkId,
    tentativeId: claim.data.tentative_id,
    sessionId,
  };
}

const tenantA = await createUserAndClient("s2b-a");
tenantA.account = await attachStripeAccount(tenantA.prestataire.id);

// ---------------------------------------------------------------------------
// Provisioning Checkout : claim / lease / complete / reprise / échec
// ---------------------------------------------------------------------------

await run("claim ouvre un provisioning creating avec lease, montant = solde", async () => {
  const { creance } = await createDraft(tenantA.client, 12000, "claim");
  const linkId = await openReceivable(tenantA.client, creance.id);
  const claim = await admin.rpc("claim_checkout_provisioning", {
    p_creance_id: creance.id,
    p_payment_link_id: linkId,
    p_stripe_account_id: tenantA.account,
    p_operation_key: randomUUID(),
    p_idempotency_key: `sidian_checkout_${randomUUID()}`,
    p_lease_seconds: 120,
  });
  if (claim.error) throw claim.error;
  assert(claim.data.status === "claimed", "status claim");
  assert(claim.data.montant === 12000, "montant = solde entier");
  assert(Boolean(claim.data.lease_token), "lease présent");

  const { rows } = await postgres.query(
    "select etat, checkout_provisioning_status, checkout_lease_token from public.tentative_paiement where id = $1",
    [claim.data.tentative_id],
  );
  assert(rows[0].etat === "CREEE", "tentative CREEE");
  assert(rows[0].checkout_provisioning_status === "creating", "status creating");
  assert(Boolean(rows[0].checkout_lease_token), "lease persisté");
});

await run("claim concurrent → in_progress, puis complete → already_created", async () => {
  const { creance } = await createDraft(tenantA.client, 12000, "concurrent");
  const linkId = await openReceivable(tenantA.client, creance.id);
  const base = {
    p_creance_id: creance.id,
    p_payment_link_id: linkId,
    p_stripe_account_id: tenantA.account,
    p_lease_seconds: 120,
  };
  const first = await admin.rpc("claim_checkout_provisioning", {
    ...base,
    p_operation_key: randomUUID(),
    p_idempotency_key: `sidian_checkout_${randomUUID()}`,
  });
  if (first.error) throw first.error;
  assert(first.data.status === "claimed", "premier claim");

  const second = await admin.rpc("claim_checkout_provisioning", {
    ...base,
    p_operation_key: randomUUID(),
    p_idempotency_key: `sidian_checkout_${randomUUID()}`,
  });
  if (second.error) throw second.error;
  assert(second.data.status === "in_progress", "second claim in_progress (lease vivant)");

  const sessionId = `cs_test_${randomUUID()}`;
  const complete = await admin.rpc("complete_checkout_provisioning", {
    p_tentative_id: first.data.tentative_id,
    p_lease_token: first.data.lease_token,
    p_stripe_checkout_session_id: sessionId,
    p_stripe_payment_intent_id: null,
    p_stripe_customer_id: null,
    p_stripe_account_id: tenantA.account,
    p_session_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    p_application_fee_amount: 0,
  });
  if (complete.error) throw complete.error;

  const reuse = await admin.rpc("claim_checkout_provisioning", {
    ...base,
    p_operation_key: randomUUID(),
    p_idempotency_key: `sidian_checkout_${randomUUID()}`,
  });
  if (reuse.error) throw reuse.error;
  assert(reuse.data.status === "already_created", "réutilisation session existante");
  assert(reuse.data.stripe_checkout_session_id === sessionId, "même session renvoyée");
});

await run("lease expiré → reclaim réutilise l'idempotency key, incrémente l'essai", async () => {
  const { creance } = await createDraft(tenantA.client, 12000, "reclaim");
  const linkId = await openReceivable(tenantA.client, creance.id);
  const idem = `sidian_checkout_${randomUUID()}`;
  const first = await admin.rpc("claim_checkout_provisioning", {
    p_creance_id: creance.id,
    p_payment_link_id: linkId,
    p_stripe_account_id: tenantA.account,
    p_operation_key: randomUUID(),
    p_idempotency_key: idem,
    p_lease_seconds: 120,
  });
  if (first.error) throw first.error;

  await postgres.query(
    "update public.tentative_paiement set checkout_lease_expires_at = timezone('utc', now()) - interval '1 minute' where id = $1",
    [first.data.tentative_id],
  );

  const reclaim = await admin.rpc("claim_checkout_provisioning", {
    p_creance_id: creance.id,
    p_payment_link_id: linkId,
    p_stripe_account_id: tenantA.account,
    p_operation_key: randomUUID(),
    p_idempotency_key: `sidian_checkout_${randomUUID()}`,
    p_lease_seconds: 120,
  });
  if (reclaim.error) throw reclaim.error;
  assert(reclaim.data.status === "reclaimed", "reclaim");
  assert(reclaim.data.idempotency_key === idem, "idempotency key réutilisée");
  assert(reclaim.data.attempt === 2, "essai incrémenté");
  assert(reclaim.data.tentative_id === first.data.tentative_id, "même tentative");
});

await run("échec terminal → tentative ANNULEE, créance libérée pour un nouveau claim", async () => {
  const { creance } = await createDraft(tenantA.client, 12000, "failterm");
  const linkId = await openReceivable(tenantA.client, creance.id);
  const claim = await admin.rpc("claim_checkout_provisioning", {
    p_creance_id: creance.id,
    p_payment_link_id: linkId,
    p_stripe_account_id: tenantA.account,
    p_operation_key: randomUUID(),
    p_idempotency_key: `sidian_checkout_${randomUUID()}`,
    p_lease_seconds: 120,
  });
  if (claim.error) throw claim.error;
  const failed = await admin.rpc("fail_checkout_provisioning", {
    p_tentative_id: claim.data.tentative_id,
    p_lease_token: claim.data.lease_token,
    p_retryable: false,
    p_error_code: "stripe_card_declined",
  });
  if (failed.error) throw failed.error;
  assert(failed.data.etat === "ANNULEE", "tentative annulée");

  const reopen = await admin.rpc("claim_checkout_provisioning", {
    p_creance_id: creance.id,
    p_payment_link_id: linkId,
    p_stripe_account_id: tenantA.account,
    p_operation_key: randomUUID(),
    p_idempotency_key: `sidian_checkout_${randomUUID()}`,
    p_lease_seconds: 120,
  });
  if (reopen.error) throw reopen.error;
  assert(reopen.data.status === "claimed", "nouveau claim après terminalisation");
});

await run("claim refuse compte connecté étranger et créance non payable", async () => {
  const { creance } = await createDraft(tenantA.client, 12000, "scope");
  const linkId = await openReceivable(tenantA.client, creance.id);
  const wrong = await admin.rpc("claim_checkout_provisioning", {
    p_creance_id: creance.id,
    p_payment_link_id: linkId,
    p_stripe_account_id: "acct_intrus",
    p_operation_key: randomUUID(),
    p_idempotency_key: `sidian_checkout_${randomUUID()}`,
    p_lease_seconds: 120,
  });
  assert(wrong.error && /stripe_account_scope_mismatch/.test(wrong.error.message), "scope refusé");

  const { creance: draft } = await createDraft(tenantA.client, 12000, "brouillon");
  const draftClaim = await admin.rpc("claim_checkout_provisioning", {
    p_creance_id: draft.id,
    p_payment_link_id: linkId,
    p_stripe_account_id: tenantA.account,
    p_operation_key: randomUUID(),
    p_idempotency_key: `sidian_checkout_${randomUUID()}`,
    p_lease_seconds: 120,
  });
  assert(
    draftClaim.error && /payment_receivable_not_payable/.test(draftClaim.error.message),
    "BROUILLON non payable",
  );
});

// ---------------------------------------------------------------------------
// Effets financiers webhook : paiement, recalcul, trop-perçu
// ---------------------------------------------------------------------------

await run("payment_intent.succeeded → RÉUSSIE + paiement + créance REGLEE", async () => {
  const pi = `pi_${randomUUID()}`;
  const prov = await provisionTentative(tenantA, { montant: 12000, paymentIntentId: pi });
  const evt = await claimWebhook("payment_intent.succeeded", tenantA.account);
  const applied = await admin.rpc("apply_eur_payment_intent_succeeded", {
    p_stripe_event_id: evt.eventId,
    p_processing_attempt: evt.attempt,
    p_lease_token: evt.leaseToken,
    p_connected_account_id: tenantA.account,
    p_payment_intent_id: pi,
    p_tentative_id: null,
    p_amount_received: 12000,
    p_currency: "eur",
    p_moyen: "carte",
  });
  if (applied.error) throw applied.error;
  assert(applied.data.applied === true, "appliqué");
  assert(applied.data.settlement.creance_state === "REGLEE", "créance REGLEE");

  const { rows: t } = await postgres.query(
    "select etat, moyen from public.tentative_paiement where id = $1",
    [prov.tentativeId],
  );
  assert(t[0].etat === "REUSSIE", "tentative REUSSIE");
  assert(t[0].moyen === "carte", "moyen renseigné");
  const { rows: p } = await postgres.query(
    "select montant, source from public.paiement where tentative_paiement_id = $1",
    [prov.tentativeId],
  );
  assert(p.length === 1 && p[0].montant === "12000" && p[0].source === "lien_agent", "paiement créé");
});

await run("succeeded rejoué (même événement) est idempotent — aucun double paiement", async () => {
  const pi = `pi_${randomUUID()}`;
  const prov = await provisionTentative(tenantA, { montant: 12000, paymentIntentId: pi });
  const evt = await claimWebhook("payment_intent.succeeded", tenantA.account);
  const args = {
    p_stripe_event_id: evt.eventId,
    p_processing_attempt: evt.attempt,
    p_lease_token: evt.leaseToken,
    p_connected_account_id: tenantA.account,
    p_payment_intent_id: pi,
    p_tentative_id: null,
    p_amount_received: 12000,
    p_currency: "eur",
    p_moyen: "carte",
  };
  const first = await admin.rpc("apply_eur_payment_intent_succeeded", args);
  if (first.error) throw first.error;
  const second = await admin.rpc("apply_eur_payment_intent_succeeded", args);
  if (second.error) throw second.error;
  assert(second.data.applied === false && second.data.reason === "already_applied", "second no-op");

  const { rows } = await postgres.query(
    "select count(*)::int as n from public.paiement where tentative_paiement_id = $1",
    [prov.tentativeId],
  );
  assert(rows[0].n === 1, "un seul paiement");
});

await run("succeeded sans tentative → rapprochement humain durable et idempotent", async () => {
  const pi = `pi_orphan_${randomUUID()}`;
  const evt = await claimWebhook("payment_intent.succeeded", tenantA.account);
  const args = {
    p_stripe_event_id: evt.eventId,
    p_processing_attempt: evt.attempt,
    p_lease_token: evt.leaseToken,
    p_connected_account_id: tenantA.account,
    p_payment_intent_id: pi,
    p_tentative_id: null,
    p_amount_received: 12000,
    p_currency: "eur",
    p_moyen: "carte",
  };

  const first = await admin.rpc("apply_eur_payment_intent_succeeded", args);
  if (first.error) throw first.error;
  assert(first.data.unresolved === true, "succès signalé non résolu");
  assert(first.data.reconciliation_required === true, "rapprochement requis");

  const second = await admin.rpc("apply_eur_payment_intent_succeeded", args);
  if (second.error) throw second.error;
  assert(
    second.data.applied === false && second.data.reason === "already_applied",
    "rejeu sans doublon",
  );

  const { rows: audit } = await postgres.query(
    `select count(*)::int as n
     from public.audit_log
     where prestataire_id = $1
       and action = 'PAYMENT_SUCCEEDED_RECONCILIATION_REQUIRED'
       and metadata ->> 'stripe_payment_intent_id' = $2`,
    [tenantA.prestataire.id, pi],
  );
  assert(audit[0].n === 1, "une trace d'audit durable");

  const { rows: approvals } = await postgres.query(
    `select count(*)::int as n
     from public.approval_request
     where prestataire_id = $1
       and creance_id is null
       and type = 'autre'
       and status = 'pending'
       and payload ->> 'stripe_payment_intent_id' = $2`,
    [tenantA.prestataire.id, pi],
  );
  assert(approvals[0].n === 1, "une demande de rapprochement durable");
});

await run("succeeded hors EUR → aucun paiement ni changement de créance", async () => {
  const pi = `pi_usd_${randomUUID()}`;
  const prov = await provisionTentative(tenantA, { montant: 12000, paymentIntentId: pi });
  const evt = await claimWebhook("payment_intent.succeeded", tenantA.account);
  const rejected = await admin.rpc("apply_eur_payment_intent_succeeded", {
    p_stripe_event_id: evt.eventId,
    p_processing_attempt: evt.attempt,
    p_lease_token: evt.leaseToken,
    p_connected_account_id: tenantA.account,
    p_payment_intent_id: pi,
    p_tentative_id: null,
    p_amount_received: 12000,
    p_currency: "usd",
    p_moyen: "carte",
  });
  assert(
    rejected.error && /payment_currency_not_supported/.test(rejected.error.message),
    "devise rejetée explicitement",
  );
  const legacyBypass = await admin.rpc("apply_payment_intent_succeeded", {
    p_stripe_event_id: evt.eventId,
    p_processing_attempt: evt.attempt,
    p_lease_token: evt.leaseToken,
    p_connected_account_id: tenantA.account,
    p_payment_intent_id: pi,
    p_tentative_id: null,
    p_amount_received: 12000,
    p_moyen: "carte",
  });
  assert(legacyBypass.error, "ancienne RPC sans devise non exécutable");

  const { rows: tentative } = await postgres.query(
    "select etat from public.tentative_paiement where id = $1",
    [prov.tentativeId],
  );
  assert(tentative[0].etat === "CREEE", "tentative inchangée");
  const { rows: creance } = await postgres.query(
    "select etat from public.creance where id = $1",
    [prov.creance.id],
  );
  assert(creance[0].etat === "OUVERTE", "créance inchangée");
  const { rows: paiement } = await postgres.query(
    "select count(*)::int as n from public.paiement where tentative_paiement_id = $1",
    [prov.tentativeId],
  );
  assert(paiement[0].n === 0, "aucun paiement créé");
});

await run("fencing : lease token invalide → webhook_lease_lost", async () => {
  const pi = `pi_${randomUUID()}`;
  await provisionTentative(tenantA, { montant: 12000, paymentIntentId: pi });
  const evt = await claimWebhook("payment_intent.succeeded", tenantA.account);
  const bad = await admin.rpc("apply_eur_payment_intent_succeeded", {
    p_stripe_event_id: evt.eventId,
    p_processing_attempt: evt.attempt,
    p_lease_token: randomUUID(),
    p_connected_account_id: tenantA.account,
    p_payment_intent_id: pi,
    p_tentative_id: null,
    p_amount_received: 12000,
    p_currency: "eur",
    p_moyen: "carte",
  });
  assert(bad.error && /webhook_lease_lost/.test(bad.error.message), "lease usurpé refusé");
});

await run("trop-perçu → REGLEE + audit + approval_request depassement_seuil", async () => {
  const pi = `pi_${randomUUID()}`;
  const prov = await provisionTentative(tenantA, { montant: 12000, paymentIntentId: pi });
  const evt = await claimWebhook("payment_intent.succeeded", tenantA.account);
  const applied = await admin.rpc("apply_eur_payment_intent_succeeded", {
    p_stripe_event_id: evt.eventId,
    p_processing_attempt: evt.attempt,
    p_lease_token: evt.leaseToken,
    p_connected_account_id: tenantA.account,
    p_payment_intent_id: pi,
    p_tentative_id: null,
    p_amount_received: 15000,
    p_currency: "eur",
    p_moyen: "carte",
  });
  if (applied.error) throw applied.error;
  assert(applied.data.settlement.creance_state === "REGLEE", "REGLEE");
  assert(applied.data.settlement.overpaid === true, "trop-perçu détecté");

  const { rows: audit } = await postgres.query(
    "select 1 from public.audit_log where entity_id = $1 and action = 'PAYMENT_OVERPAYMENT_DETECTED'",
    [prov.creance.id],
  );
  assert(audit.length === 1, "audit trop-perçu");
  const { rows: appr } = await postgres.query(
    "select 1 from public.approval_request where creance_id = $1 and type = 'depassement_seuil' and status = 'pending'",
    [prov.creance.id],
  );
  assert(appr.length === 1, "approval_request trop-perçu");
});

await run("paiements partiels → PARTIELLEMENT_REGLEE puis REGLEE au solde", async () => {
  // Première tentative partielle.
  const pi1 = `pi_${randomUUID()}`;
  const prov1 = await provisionTentative(tenantA, { montant: 12000, paymentIntentId: pi1 });
  const evt1 = await claimWebhook("payment_intent.succeeded", tenantA.account);
  const first = await admin.rpc("apply_eur_payment_intent_succeeded", {
    p_stripe_event_id: evt1.eventId,
    p_processing_attempt: evt1.attempt,
    p_lease_token: evt1.leaseToken,
    p_connected_account_id: tenantA.account,
    p_payment_intent_id: pi1,
    p_tentative_id: null,
    p_amount_received: 5000,
    p_currency: "eur",
    p_moyen: "sepa_core",
  });
  if (first.error) throw first.error;
  assert(first.data.settlement.creance_state === "PARTIELLEMENT_REGLEE", "partiel");

  // Nouveau claim sur la même créance : le lien actif existant est réutilisé,
  // pas de ré-ouverture (open_payment_receivable refuse PARTIELLEMENT_REGLEE).
  const { rows: linkRows } = await postgres.query(
    "select id from public.payment_link where creance_id = $1 and status = 'active'",
    [prov1.creance.id],
  );
  assert(linkRows.length === 1, "lien actif réutilisable");
  const linkId = linkRows[0].id;
  const claim2 = await admin.rpc("claim_checkout_provisioning", {
    p_creance_id: prov1.creance.id,
    p_payment_link_id: linkId,
    p_stripe_account_id: tenantA.account,
    p_operation_key: randomUUID(),
    p_idempotency_key: `sidian_checkout_${randomUUID()}`,
    p_lease_seconds: 120,
  });
  if (claim2.error) throw claim2.error;
  assert(claim2.data.montant === 7000, "solde restant 7000");
  const pi2 = `pi_${randomUUID()}`;
  await admin.rpc("complete_checkout_provisioning", {
    p_tentative_id: claim2.data.tentative_id,
    p_lease_token: claim2.data.lease_token,
    p_stripe_checkout_session_id: `cs_test_${randomUUID()}`,
    p_stripe_payment_intent_id: pi2,
    p_stripe_customer_id: null,
    p_stripe_account_id: tenantA.account,
    p_session_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    p_application_fee_amount: 0,
  });
  const evt2 = await claimWebhook("payment_intent.succeeded", tenantA.account);
  const second = await admin.rpc("apply_eur_payment_intent_succeeded", {
    p_stripe_event_id: evt2.eventId,
    p_processing_attempt: evt2.attempt,
    p_lease_token: evt2.leaseToken,
    p_connected_account_id: tenantA.account,
    p_payment_intent_id: pi2,
    p_tentative_id: null,
    p_amount_received: 7000,
    p_currency: "eur",
    p_moyen: "sepa_core",
  });
  if (second.error) throw second.error;
  assert(second.data.settlement.creance_state === "REGLEE", "solde atteint");
});

await run("ordre inversé : succeeded avant completed, résolu par métadonnée tentative", async () => {
  // PI non lié à la tentative au provisioning (arrivée précoce simulée).
  const prov = await provisionTentative(tenantA, { montant: 12000, paymentIntentId: null });
  const pi = `pi_${randomUUID()}`;
  const evt = await claimWebhook("payment_intent.succeeded", tenantA.account);
  const applied = await admin.rpc("apply_eur_payment_intent_succeeded", {
    p_stripe_event_id: evt.eventId,
    p_processing_attempt: evt.attempt,
    p_lease_token: evt.leaseToken,
    p_connected_account_id: tenantA.account,
    p_payment_intent_id: pi,
    p_tentative_id: prov.tentativeId,
    p_amount_received: 12000,
    p_currency: "eur",
    p_moyen: "carte",
  });
  if (applied.error) throw applied.error;
  assert(applied.data.applied === true, "résolu par tentative_id");
  const { rows } = await postgres.query(
    "select stripe_payment_intent_id from public.tentative_paiement where id = $1",
    [prov.tentativeId],
  );
  assert(rows[0].stripe_payment_intent_id === pi, "PI lié a posteriori");
});

await run("processing → EN_TRAITEMENT, payment_failed → ECHOUEE", async () => {
  const piP = `pi_${randomUUID()}`;
  const provP = await provisionTentative(tenantA, { montant: 12000, paymentIntentId: piP });
  const evtP = await claimWebhook("payment_intent.processing", tenantA.account);
  const proc = await admin.rpc("apply_payment_intent_processing", {
    p_stripe_event_id: evtP.eventId,
    p_processing_attempt: evtP.attempt,
    p_lease_token: evtP.leaseToken,
    p_connected_account_id: tenantA.account,
    p_payment_intent_id: piP,
    p_tentative_id: null,
    p_moyen: "sepa_core",
  });
  if (proc.error) throw proc.error;
  const { rows: rp } = await postgres.query(
    "select etat from public.tentative_paiement where id = $1",
    [provP.tentativeId],
  );
  assert(rp[0].etat === "EN_TRAITEMENT", "EN_TRAITEMENT");

  const piF = `pi_${randomUUID()}`;
  const provF = await provisionTentative(tenantA, { montant: 12000, paymentIntentId: piF });
  const evtF = await claimWebhook("payment_intent.payment_failed", tenantA.account);
  const failed = await admin.rpc("apply_payment_intent_payment_failed", {
    p_stripe_event_id: evtF.eventId,
    p_processing_attempt: evtF.attempt,
    p_lease_token: evtF.leaseToken,
    p_connected_account_id: tenantA.account,
    p_payment_intent_id: piF,
    p_tentative_id: null,
    p_echec_code: "card_declined",
    p_echec_message: "Votre carte a été refusée.",
  });
  if (failed.error) throw failed.error;
  const { rows: rf } = await postgres.query(
    "select etat, echec_code from public.tentative_paiement where id = $1",
    [provF.tentativeId],
  );
  assert(rf[0].etat === "ECHOUEE" && rf[0].echec_code === "card_declined", "ECHOUEE + code");
});

await run("checkout.session.expired → ANNULEE ; jamais après succeeded", async () => {
  // Cas 1 : expiration d'une tentative non terminale.
  const provE = await provisionTentative(tenantA, { montant: 12000 });
  const evtE = await claimWebhook("checkout.session.expired", tenantA.account);
  const expired = await admin.rpc("apply_checkout_session_expired_payment", {
    p_stripe_event_id: evtE.eventId,
    p_processing_attempt: evtE.attempt,
    p_lease_token: evtE.leaseToken,
    p_connected_account_id: tenantA.account,
    p_checkout_session_id: provE.sessionId,
  });
  if (expired.error) throw expired.error;
  const { rows: re } = await postgres.query(
    "select etat from public.tentative_paiement where id = $1",
    [provE.tentativeId],
  );
  assert(re[0].etat === "ANNULEE", "ANNULEE");

  // Cas 2 : succeeded d'abord, puis expired ne doit pas annuler.
  const pi = `pi_${randomUUID()}`;
  const provS = await provisionTentative(tenantA, { montant: 12000, paymentIntentId: pi });
  const evtS = await claimWebhook("payment_intent.succeeded", tenantA.account);
  await admin.rpc("apply_eur_payment_intent_succeeded", {
    p_stripe_event_id: evtS.eventId,
    p_processing_attempt: evtS.attempt,
    p_lease_token: evtS.leaseToken,
    p_connected_account_id: tenantA.account,
    p_payment_intent_id: pi,
    p_tentative_id: null,
    p_amount_received: 12000,
    p_currency: "eur",
    p_moyen: "carte",
  });
  const evtX = await claimWebhook("checkout.session.expired", tenantA.account);
  await admin.rpc("apply_checkout_session_expired_payment", {
    p_stripe_event_id: evtX.eventId,
    p_processing_attempt: evtX.attempt,
    p_lease_token: evtX.leaseToken,
    p_connected_account_id: tenantA.account,
    p_checkout_session_id: provS.sessionId,
  });
  const { rows: rs } = await postgres.query(
    "select etat from public.tentative_paiement where id = $1",
    [provS.tentativeId],
  );
  assert(rs[0].etat === "REUSSIE", "reste REUSSIE malgré expired");
});

await run("checkout.session.completed lie PI + Customer sans confirmer le paiement", async () => {
  const prov = await provisionTentative(tenantA, { montant: 12000 });
  const pi = `pi_${randomUUID()}`;
  const evt = await claimWebhook("checkout.session.completed", tenantA.account);
  const done = await admin.rpc("apply_checkout_session_completed_payment", {
    p_stripe_event_id: evt.eventId,
    p_processing_attempt: evt.attempt,
    p_lease_token: evt.leaseToken,
    p_connected_account_id: tenantA.account,
    p_checkout_session_id: prov.sessionId,
    p_payment_intent_id: pi,
    p_customer_id: `cus_${randomUUID()}`,
  });
  if (done.error) throw done.error;
  const { rows } = await postgres.query(
    "select etat, stripe_payment_intent_id, stripe_customer_id from public.tentative_paiement where id = $1",
    [prov.tentativeId],
  );
  assert(rows[0].etat === "CREEE", "état inchangé (pas de confirmation)");
  assert(rows[0].stripe_payment_intent_id === pi, "PI lié");
  assert(rows[0].stripe_customer_id?.startsWith("cus_"), "Customer lié");
});

await run("scope : succeeded avec compte connecté étranger est refusé", async () => {
  const pi = `pi_${randomUUID()}`;
  await provisionTentative(tenantA, { montant: 12000, paymentIntentId: pi });
  const evt = await claimWebhook("payment_intent.succeeded", "acct_intrus");
  const bad = await admin.rpc("apply_eur_payment_intent_succeeded", {
    p_stripe_event_id: evt.eventId,
    p_processing_attempt: evt.attempt,
    p_lease_token: evt.leaseToken,
    p_connected_account_id: "acct_intrus",
    p_payment_intent_id: pi,
    p_tentative_id: null,
    p_amount_received: 12000,
    p_currency: "eur",
    p_moyen: "carte",
  });
  assert(
    bad.error && /webhook_tentative_scope_mismatch/.test(bad.error.message),
    "scope étranger refusé",
  );
});

await run("charge.dispute.created → audit + approval formal_action, paiement intact", async () => {
  const pi = `pi_${randomUUID()}`;
  const prov = await provisionTentative(tenantA, { montant: 12000, paymentIntentId: pi });
  const evtS = await claimWebhook("payment_intent.succeeded", tenantA.account);
  await admin.rpc("apply_eur_payment_intent_succeeded", {
    p_stripe_event_id: evtS.eventId,
    p_processing_attempt: evtS.attempt,
    p_lease_token: evtS.leaseToken,
    p_connected_account_id: tenantA.account,
    p_payment_intent_id: pi,
    p_tentative_id: null,
    p_amount_received: 12000,
    p_currency: "eur",
    p_moyen: "carte",
  });
  const evtD = await claimWebhook("charge.dispute.created", tenantA.account);
  const dispute = await admin.rpc("record_charge_dispute_opened", {
    p_stripe_event_id: evtD.eventId,
    p_processing_attempt: evtD.attempt,
    p_lease_token: evtD.leaseToken,
    p_connected_account_id: tenantA.account,
    p_dispute_id: `dp_${randomUUID()}`,
    p_payment_intent_id: pi,
    p_reason: "fraudulent",
  });
  if (dispute.error) throw dispute.error;
  const { rows: audit } = await postgres.query(
    "select 1 from public.audit_log where entity_id = $1 and action = 'PAYMENT_DISPUTE_OPENED'",
    [prov.creance.id],
  );
  assert(audit.length === 1, "audit litige");
  const { rows: pmt } = await postgres.query(
    "select count(*)::int as n from public.paiement where tentative_paiement_id = $1",
    [prov.tentativeId],
  );
  assert(pmt[0].n === 1, "paiement non altéré");
});

await postgres.end();

const failures = results.filter((result) => !result.ok);
console.log(
  `\nSID-STRIPE-002-B: ${results.length - failures.length}/${results.length} tests réussis.`,
);
if (failures.length > 0) process.exitCode = 1;
