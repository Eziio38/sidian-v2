#!/usr/bin/env node
/** SID-STRIPE-003 — autorisations futures, fencing et fail-closed SEPA. */

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

const config = assertLocalTestConfig();
const localClient = (key, options = {}) =>
  createClient(config.url, key, withLocalOnlyFetch(options));
const admin = localClient(LOCAL_DEMO_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const postgres = createLocalPgClient(resolveLocalPostgresUrl(), pg);
await postgres.connect();

const results = [];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const run = async (name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`✓ ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.error(`✗ ${name}: ${error instanceof Error ? error.message : error}`);
  }
};

async function createTenant() {
  const email = `stripe-003-${randomUUID()}@sidian.test`;
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
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  const { data: prestataire, error } = await client.rpc(
    "ensure_prestataire_for_current_user",
    { p_nom: "Prestataire Stripe 003" },
  );
  if (error || !prestataire) throw error ?? new Error("prestataire absent");
  const account = `acct_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  await postgres.query(
    "update public.prestataire set stripe_account_id = $1 where id = $2",
    [account, prestataire.id],
  );
  return { client, prestataire, account };
}

async function createDraft(tenant, label = "auth") {
  const { data: clientPayeur, error: clientError } = await tenant.client.rpc(
    "create_current_client_payeur",
    {
      p_nom: `Client ${label}`,
      p_email: `${label}-${randomUUID()}@example.test`,
      p_creation_key: randomUUID(),
    },
  );
  if (clientError) throw clientError;
  const { data: creance, error: creanceError } = await tenant.client.rpc(
    "create_current_creance",
    {
      p_client_payeur_id: clientPayeur.id,
      p_montant: 12000,
      p_date_echeance: "2026-12-15",
      p_creation_key: randomUUID(),
      p_libelle: label,
    },
  );
  if (creanceError) throw creanceError;
  return { clientPayeur, creance };
}

async function createUnexposedProposal(tenant, label = "proposal") {
  const { clientPayeur, creance } = await createDraft(tenant, label);
  const { data: opened, error: openError } = await tenant.client.rpc(
    "open_payment_receivable",
    { p_creance_id: creance.id },
  );
  if (openError) throw openError;
  const customer = `cus_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  await postgres.query(
    `insert into public.stripe_customer_binding
      (prestataire_id, client_payeur_id, stripe_account_id, stripe_customer_id, status)
     values ($1, $2, $3, $4, 'active')`,
    [tenant.prestataire.id, clientPayeur.id, tenant.account, customer],
  );
  const { data: claim, error: claimError } = await admin.rpc(
    "claim_checkout_provisioning",
    {
      p_creance_id: creance.id,
      p_payment_link_id: opened.payment_link_id,
      p_stripe_account_id: tenant.account,
      p_operation_key: randomUUID(),
      p_idempotency_key: `sidian_checkout_${randomUUID()}`,
      p_lease_seconds: 120,
    },
  );
  if (claimError) throw claimError;
  const rawAuthorizationToken = randomUUID().replaceAll("-", "") + "abcdefghijk";
  const tokenHash = hash(rawAuthorizationToken);
  const { data: proposal, error: proposalError } = await admin.rpc(
    "prepare_payment_authorization_proposal",
    {
      p_tentative_id: claim.tentative_id,
      p_stripe_account_id: tenant.account,
      p_stripe_customer_id: customer,
      p_public_token_hash: tokenHash,
      p_public_token_expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
      p_authorization_text_version: "sidian-future-payments-fr-v1",
    },
  );
  if (proposalError) throw proposalError;
  return {
    clientPayeur,
    creance,
    opened,
    customer,
    claim,
    proposal,
    tokenHash,
  };
}

async function exposePaymentSession(tenant, fixture) {
  const session = `cs_payment_${randomUUID()}`;
  const { error } = await admin.rpc("complete_checkout_provisioning", {
    p_tentative_id: fixture.claim.tentative_id,
    p_lease_token: fixture.claim.lease_token,
    p_stripe_checkout_session_id: session,
    p_stripe_payment_intent_id: `pi_${randomUUID()}`,
    p_stripe_customer_id: fixture.customer,
    p_stripe_account_id: tenant.account,
    p_session_expires_at: new Date(Date.now() + 1800_000).toISOString(),
    p_application_fee_amount: 0,
  });
  if (error) throw error;
  return session;
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
  if (error || !data?.claimed) throw error ?? new Error("webhook claim absent");
  return { eventId, attempt: data.attempt, leaseToken: data.lease_token };
}

const tenant = await createTenant();
let activeFixture;
let activeAuthorizationId;

await run("fonctions sensibles SECURITY DEFINER/search_path et ACL service_role", async () => {
  const { rows } = await postgres.query(`
    select p.proname, p.prosecdef, pg_get_functiondef(p.oid) as definition,
      has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
      has_function_privilege('service_role', p.oid, 'EXECUTE') as service_exec
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'prepare_payment_authorization_proposal',
      'claim_payment_authorization_setup',
      'apply_setup_intent_succeeded_authorization',
      'apply_payment_method_detached_authorization',
      'apply_mandate_updated_authorization',
      'prepare_reconsidered_authorization_proposal',
      'suspend_payment_authorization_for_dispute',
      'apply_charge_dispute_created_effects'
    )
  `);
  assert(rows.length === 8, "inventaire fonctions incomplet");
  for (const row of rows) {
    assert(row.prosecdef, `${row.proname} sans SECURITY DEFINER`);
    assert(/SET search_path TO 'pg_catalog', 'public', 'pg_temp'/.test(row.definition), `${row.proname} search_path`);
    assert(!row.anon_exec && !row.auth_exec && row.service_exec, `${row.proname} ACL`);
    if (row.proname === "apply_mandate_updated_authorization") {
      const definition = row.definition.toLowerCase();
      assert(
        definition.indexOf("pg_advisory_xact_lock") <
          definition.indexOf("for update of a"),
        "ordre de verrou mandate non advisory→row",
      );
    }
  }
});

await run("consentement explicite → setup claim stable → activation SEPA webhook", async () => {
  activeFixture = await createUnexposedProposal(tenant, "lifecycle");
  const sourceSession = await exposePaymentSession(tenant, activeFixture);
  const { data: before } = await admin.rpc("resolve_payment_authorization_public", {
    p_public_token_hash: activeFixture.tokenHash,
    p_source_checkout_session_id: sourceSession,
    p_setup_checkout_session_id: null,
  });
  assert(before.found && before.etat === "PROPOSEE", "proposition publique résolue");

  const args = {
    p_public_token_hash: activeFixture.tokenHash,
    p_source_checkout_session_id: sourceSession,
    p_stripe_account_id: tenant.account,
    p_stripe_customer_id: activeFixture.customer,
    p_authorization_text_version: "sidian-future-payments-fr-v1",
    p_lease_seconds: 120,
  };
  const { data: claim, error: claimError } = await admin.rpc(
    "claim_payment_authorization_setup",
    args,
  );
  if (claimError) throw claimError;
  assert(claim.status === "claimed", "premier claim setup");
  activeAuthorizationId = claim.authorization_id;
  const { data: concurrent } = await admin.rpc("claim_payment_authorization_setup", args);
  assert(concurrent.status === "in_progress", "claim concurrent bloqué");

  const setupSession = `cs_setup_${randomUUID()}`;
  const setupIntent = `seti_${randomUUID()}`;
  const { error: completeError } = await admin.rpc(
    "complete_payment_authorization_setup",
    {
      p_authorization_id: activeAuthorizationId,
      p_lease_token: claim.lease_token,
      p_stripe_account_id: tenant.account,
      p_stripe_customer_id: activeFixture.customer,
      p_stripe_setup_checkout_session_id: setupSession,
      p_stripe_setup_intent_id: setupIntent,
      p_session_expires_at: new Date(Date.now() + 1800_000).toISOString(),
    },
  );
  if (completeError) throw completeError;

  const webhook = await claimWebhook("setup_intent.succeeded", tenant.account);
  const mandate = `mandate_${randomUUID()}`;
  const paymentMethod = `pm_${randomUUID()}`;
  const effectArgs = {
    p_stripe_event_id: webhook.eventId,
    p_processing_attempt: webhook.attempt,
    p_lease_token: webhook.leaseToken,
    p_connected_account_id: tenant.account,
    p_setup_intent_id: setupIntent,
    p_authorization_id: activeAuthorizationId,
    p_authorization_text_version: "sidian-future-payments-fr-v1",
    p_customer_id: activeFixture.customer,
    p_payment_method_id: paymentMethod,
    p_payment_method_type: "sepa_debit",
    p_mandate_id: mandate,
    p_mandate_status: "active",
  };
  const { data: activated, error: activateError } = await admin.rpc(
    "apply_setup_intent_succeeded_authorization",
    effectArgs,
  );
  if (activateError) throw activateError;
  assert(activated.state === "ACTIVE" && activated.is_default, "autorisation ACTIVE/default");
  const { data: replay } = await admin.rpc(
    "apply_setup_intent_succeeded_authorization",
    effectArgs,
  );
  assert(replay.reason === "already_applied", "rejeu idempotent");
});

await run("fencing refuse un lease usurpé sans transition", async () => {
  const webhook = await claimWebhook("payment_method.detached", tenant.account);
  const { rows: before } = await postgres.query(
    "select etat from public.payment_authorization where id = $1",
    [activeAuthorizationId],
  );
  const rejected = await admin.rpc("apply_payment_method_detached_authorization", {
    p_stripe_event_id: webhook.eventId,
    p_processing_attempt: webhook.attempt,
    p_lease_token: randomUUID(),
    p_connected_account_id: tenant.account,
    p_payment_method_id: `pm_intrus`,
  });
  assert(rejected.error && /webhook_lease_lost/.test(rejected.error.message), "lease refusé");
  const { rows: after } = await postgres.query(
    "select etat from public.payment_authorization where id = $1",
    [activeAuthorizationId],
  );
  assert(after[0].etat === before[0].etat, "état inchangé");
});

await run("setup completion borne l'expiration et fail refuse un lease temporel périmé", async () => {
  const fixture = await createUnexposedProposal(tenant, "setup-fence-time");
  const sourceSession = await exposePaymentSession(tenant, fixture);
  const { data: claim, error: claimError } = await admin.rpc(
    "claim_payment_authorization_setup",
    {
      p_public_token_hash: fixture.tokenHash,
      p_source_checkout_session_id: sourceSession,
      p_stripe_account_id: tenant.account,
      p_stripe_customer_id: fixture.customer,
      p_authorization_text_version: "sidian-future-payments-fr-v1",
      p_lease_seconds: 120,
    },
  );
  if (claimError) throw claimError;
  const invalidCompletion = await admin.rpc("complete_payment_authorization_setup", {
    p_authorization_id: claim.authorization_id,
    p_lease_token: claim.lease_token,
    p_stripe_account_id: tenant.account,
    p_stripe_customer_id: fixture.customer,
    p_stripe_setup_checkout_session_id: `cs_setup_invalid_${randomUUID()}`,
    p_stripe_setup_intent_id: null,
    p_session_expires_at: new Date(Date.now() - 60_000).toISOString(),
  });
  assert(
    invalidCompletion.error &&
      /authorization_setup_session_expiry_invalid/.test(invalidCompletion.error.message),
    "expiration setup incohérente acceptée",
  );
  await postgres.query(
    `update public.payment_authorization
     set setup_lease_expires_at = timezone('utc', now()) - interval '1 second'
     where id = $1`,
    [claim.authorization_id],
  );
  const expiredFailure = await admin.rpc("fail_payment_authorization_setup", {
    p_authorization_id: claim.authorization_id,
    p_lease_token: claim.lease_token,
    p_retryable: true,
    p_error_code: "network_error",
  });
  assert(
    expiredFailure.error && /authorization_setup_lease_lost/.test(expiredFailure.error.message),
    "worker setup périmé a finalisé un échec",
  );
  const { rows } = await postgres.query(
    `select setup_provisioning_status, setup_lease_token
     from public.payment_authorization where id = $1`,
    [claim.authorization_id],
  );
  assert(
    rows[0].setup_provisioning_status === "creating" && rows[0].setup_lease_token,
    "projection setup modifiée malgré lease périmé",
  );
});

await run("SEPA off-session reste impossible sans validation prénotification", async () => {
  const { data: creance, error } = await tenant.client.rpc("create_current_creance", {
    p_client_payeur_id: activeFixture.clientPayeur.id,
    p_montant: 5000,
    p_date_echeance: "2026-12-20",
    p_creation_key: randomUUID(),
    p_libelle: "SEPA bloqué",
  });
  if (error) throw error;
  await tenant.client.rpc("open_payment_receivable", { p_creance_id: creance.id });
  let rejected = false;
  try {
    await postgres.query(
      `insert into public.tentative_paiement
        (creance_id, montant, moyen, source, etat, payment_authorization_id,
         automatic_execution_guard_version)
       values ($1, 5000, 'sepa_core', 'prelevement_auto', 'CREEE', $2,
         'sidian-auto-payment-guard-v1')`,
      [creance.id, activeAuthorizationId],
    );
  } catch (insertError) {
    rejected = /sepa_prenotification_validation_required/.test(insertError.message);
  }
  assert(rejected, "tentative SEPA refusée fail-closed");
});

await run("detached suspend puis mandate active réactive", async () => {
  const { rows } = await postgres.query(
    `select stripe_payment_method_id, stripe_mandate_id
     from public.payment_authorization where id = $1`,
    [activeAuthorizationId],
  );
  const pm = rows[0].stripe_payment_method_id;
  const mandate = rows[0].stripe_mandate_id;

  const detached = await claimWebhook("payment_method.detached", tenant.account);
  const { error: detachedError } = await admin.rpc(
    "apply_payment_method_detached_authorization",
    {
      p_stripe_event_id: detached.eventId,
      p_processing_attempt: detached.attempt,
      p_lease_token: detached.leaseToken,
      p_connected_account_id: tenant.account,
      p_payment_method_id: pm,
    },
  );
  if (detachedError) throw detachedError;
  let state = await postgres.query(
    "select etat, is_default from public.payment_authorization where id = $1",
    [activeAuthorizationId],
  );
  assert(state.rows[0].etat === "SUSPENDUE" && !state.rows[0].is_default, "suspendue");

  const webhook = await claimWebhook("mandate.updated", tenant.account);
  const { error } = await admin.rpc("apply_mandate_updated_authorization", {
    p_stripe_event_id: webhook.eventId,
    p_processing_attempt: webhook.attempt,
    p_lease_token: webhook.leaseToken,
    p_connected_account_id: tenant.account,
    p_mandate_id: mandate,
    p_mandate_status: "active",
    p_payment_method_id: pm,
    p_customer_id: activeFixture.customer,
  });
  if (error) throw error;
  state = await postgres.query(
    "select etat, is_default from public.payment_authorization where id = $1",
    [activeAuthorizationId],
  );
  assert(state.rows[0].etat === "ACTIVE" && state.rows[0].is_default, "réactivée");
});

await run("dispute rattachée suspend l'ACTIVE/default relationnelle sans effet financier ; orpheline non", async () => {
  const { data: disputedCreance, error: creanceError } = await tenant.client.rpc(
    "create_current_creance",
    {
      p_client_payeur_id: activeFixture.clientPayeur.id,
      p_montant: 7100,
      p_date_echeance: "2026-12-22",
      p_creation_key: randomUUID(),
      p_libelle: "Dispute relationnelle",
    },
  );
  if (creanceError) throw creanceError;
  const { data: opened, error: openError } = await tenant.client.rpc(
    "open_payment_receivable",
    { p_creance_id: disputedCreance.id },
  );
  if (openError) throw openError;
  const { data: claim, error: claimError } = await admin.rpc(
    "claim_checkout_provisioning",
    {
      p_creance_id: disputedCreance.id,
      p_payment_link_id: opened.payment_link_id,
      p_stripe_account_id: tenant.account,
      p_operation_key: randomUUID(),
      p_idempotency_key: `sidian_checkout_${randomUUID()}`,
      p_lease_seconds: 120,
    },
  );
  if (claimError) throw claimError;
  const disputedPi = `pi_relation_${randomUUID()}`;
  const { error: completeError } = await admin.rpc("complete_checkout_provisioning", {
    p_tentative_id: claim.tentative_id,
    p_lease_token: claim.lease_token,
    p_stripe_checkout_session_id: `cs_relation_${randomUUID()}`,
    p_stripe_payment_intent_id: disputedPi,
    p_stripe_customer_id: activeFixture.customer,
    p_stripe_account_id: tenant.account,
    p_session_expires_at: new Date(Date.now() + 1800_000).toISOString(),
    p_application_fee_amount: 0,
  });
  if (completeError) throw completeError;

  const before = await postgres.query(
    `select t.etat as tentative_etat, c.etat as creance_etat,
      (select count(*)::int from public.paiement p where p.creance_id = c.id) as paiements
     from public.tentative_paiement t
     join public.creance c on c.id = t.creance_id
     where t.id = $1`,
    [claim.tentative_id],
  );
  const webhook = await claimWebhook("charge.dispute.created", tenant.account);
  const args = {
    p_stripe_event_id: webhook.eventId,
    p_processing_attempt: webhook.attempt,
    p_lease_token: webhook.leaseToken,
    p_connected_account_id: tenant.account,
    p_dispute_id: `dp_relation_${randomUUID()}`,
    p_payment_intent_id: disputedPi,
    p_reason: "fraudulent",
  };
  const { data: applied, error: disputeError } = await admin.rpc(
    "apply_charge_dispute_created_effects",
    args,
  );
  if (disputeError) throw disputeError;
  assert(
    applied.authorization.authorization_suspended === true,
    "autorisation relationnelle non suspendue",
  );
  const after = await postgres.query(
    `select t.etat as tentative_etat, c.etat as creance_etat,
      (select count(*)::int from public.paiement p where p.creance_id = c.id) as paiements
     from public.tentative_paiement t
     join public.creance c on c.id = t.creance_id
     where t.id = $1`,
    [claim.tentative_id],
  );
  assert(
    JSON.stringify(after.rows[0]) === JSON.stringify(before.rows[0]),
    "dispute a modifié tentative/créance/paiement",
  );
  let state = await postgres.query(
    `select etat, is_default, suspension_reason
     from public.payment_authorization where id = $1`,
    [activeAuthorizationId],
  );
  assert(
    state.rows[0].etat === "SUSPENDUE" &&
      !state.rows[0].is_default &&
      state.rows[0].suspension_reason === "charge_dispute_created",
    "projection dispute incorrecte",
  );

  const { data: replay, error: replayError } = await admin.rpc(
    "apply_charge_dispute_created_effects",
    args,
  );
  if (replayError) throw replayError;
  assert(
    replay.record.reason === "already_applied" &&
      replay.authorization.reason === "already_applied",
    "replay dispute non idempotent",
  );

  const orphanWebhook = await claimWebhook("charge.dispute.created", tenant.account);
  const { data: orphan, error: orphanError } = await admin.rpc(
    "apply_charge_dispute_created_effects",
    {
      p_stripe_event_id: orphanWebhook.eventId,
      p_processing_attempt: orphanWebhook.attempt,
      p_lease_token: orphanWebhook.leaseToken,
      p_connected_account_id: tenant.account,
      p_dispute_id: `dp_orphan_${randomUUID()}`,
      p_payment_intent_id: `pi_orphan_${randomUUID()}`,
      p_reason: "other",
    },
  );
  if (orphanError) throw orphanError;
  assert(
    orphan.authorization.authorization_suspended === false &&
      orphan.authorization.reason === "tentative_unresolved",
    "dispute orpheline a suspendu une autorisation",
  );

  const { rows } = await postgres.query(
    `select stripe_payment_method_id, stripe_mandate_id
     from public.payment_authorization where id = $1`,
    [activeAuthorizationId],
  );
  const activeMandate = await claimWebhook("mandate.updated", tenant.account);
  const { error: activeMandateError } = await admin.rpc(
    "apply_mandate_updated_authorization",
    {
      p_stripe_event_id: activeMandate.eventId,
      p_processing_attempt: activeMandate.attempt,
      p_lease_token: activeMandate.leaseToken,
      p_connected_account_id: tenant.account,
      p_mandate_id: rows[0].stripe_mandate_id,
      p_mandate_status: "active",
      p_payment_method_id: rows[0].stripe_payment_method_id,
      p_customer_id: activeFixture.customer,
    },
  );
  if (activeMandateError) throw activeMandateError;
  state = await postgres.query(
    "select etat, suspension_reason from public.payment_authorization where id = $1",
    [activeAuthorizationId],
  );
  assert(
    state.rows[0].etat === "SUSPENDUE" &&
      state.rows[0].suspension_reason === "charge_dispute_created",
    "mandate.updated a levé la suspension de litige",
  );

  const inactiveMandate = await claimWebhook("mandate.updated", tenant.account);
  const { error: inactiveError } = await admin.rpc(
    "apply_mandate_updated_authorization",
    {
      p_stripe_event_id: inactiveMandate.eventId,
      p_processing_attempt: inactiveMandate.attempt,
      p_lease_token: inactiveMandate.leaseToken,
      p_connected_account_id: tenant.account,
      p_mandate_id: rows[0].stripe_mandate_id,
      p_mandate_status: "inactive",
      p_payment_method_id: rows[0].stripe_payment_method_id,
      p_customer_id: activeFixture.customer,
    },
  );
  if (inactiveError) throw inactiveError;
  const terminalWebhook = await claimWebhook("mandate.updated", tenant.account);
  const { data: terminalNoop, error: terminalError } = await admin.rpc(
    "apply_mandate_updated_authorization",
    {
      p_stripe_event_id: terminalWebhook.eventId,
      p_processing_attempt: terminalWebhook.attempt,
      p_lease_token: terminalWebhook.leaseToken,
      p_connected_account_id: tenant.account,
      p_mandate_id: rows[0].stripe_mandate_id,
      p_mandate_status: "inactive",
      p_payment_method_id: rows[0].stripe_payment_method_id,
      p_customer_id: activeFixture.customer,
    },
  );
  if (terminalError) throw terminalError;
  assert(
    terminalNoop.reason === "authorization_state_terminal_noop" &&
      terminalNoop.state === "REVOQUEE",
    "event distinct après révocation non traité en no-op",
  );
});

await run("proposition jamais exposée neutralisée → tentative suivante repropose", async () => {
  const first = await createUnexposedProposal(tenant, "neutralize");
  const { data: neutralized, error } = await admin.rpc(
    "neutralize_unexposed_authorization_proposal",
    {
      p_tentative_id: first.claim.tentative_id,
      p_checkout_lease_token: first.claim.lease_token,
      p_public_token_hash: first.tokenHash,
      p_reason: "checkout_creation_failed_terminal",
    },
  );
  if (error) throw error;
  assert(neutralized.neutralized, "proposition neutralisée");
  await admin.rpc("fail_checkout_provisioning", {
    p_tentative_id: first.claim.tentative_id,
    p_lease_token: first.claim.lease_token,
    p_retryable: false,
    p_error_code: "stripe_invalid_request",
  });
  const { data: secondClaim, error: secondClaimError } = await admin.rpc(
    "claim_checkout_provisioning",
    {
      p_creance_id: first.creance.id,
      p_payment_link_id: first.opened.payment_link_id,
      p_stripe_account_id: tenant.account,
      p_operation_key: randomUUID(),
      p_idempotency_key: `sidian_checkout_${randomUUID()}`,
      p_lease_seconds: 120,
    },
  );
  if (secondClaimError) throw secondClaimError;
  const secondHash = hash(`second-${randomUUID()}`);
  const { data: secondProposal, error: proposalError } = await admin.rpc(
    "prepare_payment_authorization_proposal",
    {
      p_tentative_id: secondClaim.tentative_id,
      p_stripe_account_id: tenant.account,
      p_stripe_customer_id: first.customer,
      p_public_token_hash: secondHash,
      p_public_token_expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
      p_authorization_text_version: "sidian-future-payments-fr-v1",
    },
  );
  if (proposalError) throw proposalError;
  assert(secondProposal.status === "proposed", "nouvelle proposition permise");
});

await run("reconsidération conserve chaque REFUSEE, déduplique le cycle et permet un nouveau cycle", async () => {
  const fixture = await createUnexposedProposal(tenant, "reconsideration");
  const sourceSession = await exposePaymentSession(tenant, fixture);
  const { data: firstDecline, error: firstDeclineError } = await admin.rpc(
    "decline_payment_authorization_proposal",
    {
      p_public_token_hash: fixture.tokenHash,
      p_source_checkout_session_id: sourceSession,
    },
  );
  if (firstDeclineError) throw firstDeclineError;
  assert(firstDecline.declined, "premier refus absent");

  const paymentLinkHash = hash(fixture.opened.raw_token);
  const { data: firstContext, error: firstContextError } = await admin.rpc(
    "resolve_authorization_reconsideration_context",
    { p_payment_link_token_hash: paymentLinkHash },
  );
  if (firstContextError) throw firstContextError;
  assert(
    firstContext.found && firstContext.authorization_id === fixture.proposal.authorization_id,
    "contexte du premier refus absent",
  );

  const firstCycleHash = hash(`reconsider-cycle-1-${randomUUID()}`);
  const firstCycleArgs = {
    p_payment_link_token_hash: paymentLinkHash,
    p_refused_authorization_id: firstContext.authorization_id,
    p_stripe_account_id: tenant.account,
    p_stripe_customer_id: fixture.customer,
    p_public_token_hash: firstCycleHash,
    p_public_token_expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
    p_authorization_text_version: "sidian-future-payments-fr-v1",
  };
  const [firstAttempt, replayAttempt] = await Promise.all([
    admin.rpc("prepare_reconsidered_authorization_proposal", firstCycleArgs),
    admin.rpc("prepare_reconsidered_authorization_proposal", firstCycleArgs),
  ]);
  if (firstAttempt.error) throw firstAttempt.error;
  if (replayAttempt.error) throw replayAttempt.error;
  assert(
    firstAttempt.data.authorization_id === replayAttempt.data.authorization_id,
    "double clic a créé deux autorisations",
  );
  assert(
    [firstAttempt.data.replayed, replayAttempt.data.replayed].filter(Boolean).length === 1,
    "replay du cycle non distingué",
  );
  const childId = firstAttempt.data.authorization_id;
  const { rows: firstHistory } = await postgres.query(
    `select id, etat, reconsidered_from_authorization_id, public_token_hash
     from public.payment_authorization
     where source_tentative_paiement_id = $1
     order by created_at, id`,
    [fixture.claim.tentative_id],
  );
  const original = firstHistory.find(
    (row) => row.id === fixture.proposal.authorization_id,
  );
  const child = firstHistory.find((row) => row.id === childId);
  assert(original?.etat === "REFUSEE", "REFUSEE d'origine réécrite");
  assert(
    child?.etat === "PROPOSEE" &&
      child.reconsidered_from_authorization_id === original.id &&
      child.public_token_hash !== original.public_token_hash,
    "nouvelle ligne de reconsidération incorrecte",
  );
  const { data: hiddenWhileLive } = await admin.rpc(
    "resolve_authorization_reconsideration_context",
    { p_payment_link_token_hash: paymentLinkHash },
  );
  assert(!hiddenWhileLive.found, "option réaffichée avec PROPOSEE existante");

  const { error: secondDeclineError } = await admin.rpc(
    "decline_payment_authorization_proposal",
    {
      p_public_token_hash: firstCycleHash,
      p_source_checkout_session_id: sourceSession,
    },
  );
  if (secondDeclineError) throw secondDeclineError;
  const { data: secondContext, error: secondContextError } = await admin.rpc(
    "resolve_authorization_reconsideration_context",
    { p_payment_link_token_hash: paymentLinkHash },
  );
  if (secondContextError) throw secondContextError;
  assert(
    secondContext.found && secondContext.authorization_id === childId,
    "nouveau refus non sélectionné pour le cycle suivant",
  );

  const secondCycleHash = hash(`reconsider-cycle-2-${randomUUID()}`);
  const { data: secondCycle, error: secondCycleError } = await admin.rpc(
    "prepare_reconsidered_authorization_proposal",
    {
      ...firstCycleArgs,
      p_refused_authorization_id: childId,
      p_public_token_hash: secondCycleHash,
    },
  );
  if (secondCycleError) throw secondCycleError;
  assert(
    secondCycle.authorization_id !== childId && secondCycleHash !== firstCycleHash,
    "second cycle non distinct",
  );
  const { rows: finalHistory } = await postgres.query(
    `select etat, count(*)::int as count
     from public.payment_authorization
     where source_tentative_paiement_id = $1
     group by etat`,
    [fixture.claim.tentative_id],
  );
  const refusedCount = finalHistory.find((row) => row.etat === "REFUSEE")?.count;
  const proposedCount = finalHistory.find((row) => row.etat === "PROPOSEE")?.count;
  assert(refusedCount === 2 && proposedCount === 1, "historique des cycles incomplet");

  const setupIntentA = `seti_contradiction_a_${randomUUID()}`;
  const setupIntentB = `seti_contradiction_b_${randomUUID()}`;
  await postgres.query(
    `update public.payment_authorization
     set stripe_setup_intent_id = $1
     where id = $2`,
    [setupIntentA, fixture.proposal.authorization_id],
  );
  await postgres.query(
    `update public.payment_authorization
     set etat = 'EN_CONFIGURATION',
         accepted_at = timezone('utc', now()),
         authorization_channel = 'public_checkout_return',
         stripe_setup_checkout_session_id = $1,
         stripe_setup_intent_id = $2,
         stripe_setup_session_expires_at = timezone('utc', now()) + interval '30 minutes',
         setup_provisioning_status = 'created'
     where id = $3`,
    [`cs_setup_identity_${randomUUID()}`, setupIntentB, secondCycle.authorization_id],
  );
  let contradictionRejected = false;
  try {
    await postgres.query(
      `select public.resolve_setup_authorization($1, $2, $3, $4, $5)`,
      [
        setupIntentA,
        secondCycle.authorization_id,
        tenant.account,
        fixture.customer,
        "sidian-future-payments-fr-v1",
      ],
    );
  } catch (error) {
    contradictionRejected = /setup_authorization_object_mismatch/.test(error.message);
  }
  assert(contradictionRejected, "contradiction SetupIntent/metadata acceptée");

  let versionRejected = false;
  try {
    await postgres.query(
      `select public.resolve_setup_authorization($1, $2, $3, $4, $5)`,
      [
        setupIntentB,
        secondCycle.authorization_id,
        tenant.account,
        fixture.customer,
        "consent-version-inconnue",
      ],
    );
  } catch (error) {
    versionRejected = /setup_authorization_object_mismatch/.test(error.message);
  }
  assert(versionRejected, "version de consentement divergente acceptée");
});

await run("legacy_incomplete refuse off-session et set_default", async () => {
  const { clientPayeur, creance } = await createDraft(tenant, "legacy");

  let activeWithoutSnapshotsRejected = false;
  try {
    await postgres.query(
      `insert into public.payment_authorization (
         prestataire_id, client_payeur_id, type, etat, is_default,
         stripe_payment_method_id, authorized_at, authorization_text_version,
         authorization_channel
       ) values (
         $1, $2, 'card_off_session', 'ACTIVE', true,
         'pm_legacy_incomplete', timezone('utc', now()),
         'sidian-future-payments-fr-v1', 'stripe_checkout_setup'
       )`,
      [tenant.prestataire.id, clientPayeur.id],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    activeWithoutSnapshotsRejected =
      /payment_authorization_configured_requires_snapshots_ck/.test(message);
  }
  assert(
    activeWithoutSnapshotsRejected,
    "ACTIVE sans snapshots aurait dû être refusée",
  );

  const forced = await postgres.query(
    `insert into public.payment_authorization (
       prestataire_id, client_payeur_id, type, etat, is_default,
       stripe_payment_method_id, authorized_at, authorization_text_version,
       authorization_channel, legacy_incomplete, suspension_reason
     ) values (
       $1, $2, 'card_off_session', 'SUSPENDUE', false,
       'pm_legacy_incomplete', timezone('utc', now()),
       'sidian-future-payments-fr-v1', 'stripe_checkout_setup',
       true, 'legacy_incomplete_projection'
     )
     returning id, etat, legacy_incomplete, is_default, suspension_reason`,
    [tenant.prestataire.id, clientPayeur.id],
  );
  const legacyId = forced.rows[0].id;
  assert(forced.rows[0].legacy_incomplete === true, "legacy non marquée");
  assert(forced.rows[0].etat === "SUSPENDUE", "legacy non suspendue");
  assert(forced.rows[0].is_default === false, "legacy encore default");
  assert(
    forced.rows[0].suspension_reason === "legacy_incomplete_projection",
    "raison legacy absente",
  );

  let setDefaultRejected = false;
  try {
    await postgres.query(
      `select public.set_default_payment_authorization($1)`,
      [legacyId],
    );
  } catch (error) {
    setDefaultRejected = /payment_authorization_not_active/.test(
      error instanceof Error ? error.message : String(error),
    );
  }
  assert(setDefaultRejected, "set_default legacy accepté");

  const { data: opened, error: openError } = await tenant.client.rpc(
    "open_payment_receivable",
    { p_creance_id: creance.id },
  );
  if (openError || !opened) throw openError ?? new Error("open receivable failed");

  let autoRejected = false;
  try {
    await postgres.query(
      `insert into public.tentative_paiement (
         creance_id, montant, moyen, source, etat, payment_authorization_id,
         automatic_execution_guard_version
       ) values ($1, 5000, 'carte', 'prelevement_auto', 'CREEE', $2,
         'sidian-auto-payment-guard-v1')`,
      [creance.id, legacyId],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    autoRejected = /automatic_payment_authorization_ineligible/.test(message);
  }
  assert(autoRejected, "off-session legacy accepté");
});

await run("authenticated ne peut jamais muter payment_authorization", async () => {
  const { error } = await tenant.client
    .from("payment_authorization")
    .update({ etat: "ACTIVE" })
    .eq("id", activeAuthorizationId);
  assert(error, "UPDATE navigateur aurait dû être refusé");
});

await postgres.end();
const failures = results.filter((result) => !result.ok);
console.log(`\nSID-STRIPE-003: ${results.length - failures.length}/${results.length} tests réussis.`);
if (failures.length > 0) process.exit(1);
