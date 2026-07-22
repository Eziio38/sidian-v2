#!/usr/bin/env node
/**
 * SID-STRIPE-003 — garde-fous durables pour les webhooks financiers orphelins.
 * Supabase local uniquement.
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

function errorMessage(error) {
  return error instanceof Error
    ? error.message
    : error && typeof error === "object" && "message" in error
      ? String(error.message)
      : String(error);
}

async function run(name, test) {
  try {
    await test();
    results.push({ ok: true, name });
    console.log(`✓ ${name}`);
  } catch (error) {
    const message = errorMessage(error);
    results.push({ ok: false, name, message });
    console.error(`✗ ${name}: ${message}`);
  }
}

async function createTenant() {
  const suffix = randomUUID();
  const email = `stripe-003-orphans-${suffix}@sidian.test`;
  const password = "Stripe003-Local-Password1!";
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
    p_nom: "Agence Stripe 003 Orphans",
  });
  if (ensured.error || !ensured.data) throw ensured.error;

  const accountId = `acct_orphan_${suffix.replaceAll("-", "")}`;
  await postgres.query(
    "update public.prestataire set stripe_account_id = $1 where id = $2",
    [accountId, ensured.data.id],
  );

  return {
    prestataireId: ensured.data.id,
    accountId,
  };
}

async function claimWebhook(type, accountId) {
  const eventId = `evt_orphan_${randomUUID()}`;
  const claim = await admin.rpc("claim_stripe_webhook_event", {
    p_event_id: eventId,
    p_type: type,
    p_stripe_connected_account_id: accountId,
    p_lease_seconds: 60,
    p_max_attempts: 8,
  });
  if (claim.error || !claim.data?.claimed) {
    throw claim.error ?? new Error("claim webhook absent");
  }
  return {
    eventId,
    attempt: claim.data.attempt,
    leaseToken: claim.data.lease_token,
  };
}

async function financialSnapshot(prestataireId) {
  const snapshot = await postgres.query(
    `select
       (select count(*)::int
        from public.creance c
        where c.prestataire_id = $1) as creances,
       (select count(*)::int
        from public.tentative_paiement t
        join public.creance c on c.id = t.creance_id
        where c.prestataire_id = $1) as tentatives,
       (select count(*)::int
        from public.paiement pmt
        join public.creance c on c.id = pmt.creance_id
        where c.prestataire_id = $1) as paiements`,
    [prestataireId],
  );
  return snapshot.rows[0];
}

function assertSameFinancialSnapshot(before, after, context) {
  assert(
    JSON.stringify(after) === JSON.stringify(before),
    `${context}: mutation financière détectée (${JSON.stringify({ before, after })})`,
  );
}

async function countAudit(action, eventId) {
  const counted = await postgres.query(
    `select count(*)::int as count
     from public.audit_log
     where action = $1 and metadata ->> 'stripe_event_id' = $2`,
    [action, eventId],
  );
  return counted.rows[0].count;
}

async function countApproval(eventId) {
  const counted = await postgres.query(
    `select count(*)::int as count
     from public.approval_request
     where payload ->> 'stripe_event_id' = $1`,
    [eventId],
  );
  return counted.rows[0].count;
}

async function countEffect(eventId) {
  const counted = await postgres.query(
    `select count(*)::int as count
     from public.stripe_webhook_effect
     where stripe_event_id = $1`,
    [eventId],
  );
  return counted.rows[0].count;
}

await postgres.connect();
const tenant = await createTenant();

await run("RPC orphelins : SECURITY DEFINER, search_path explicite et service_role seul", async () => {
  const names = [
    "apply_payment_intent_processing",
    "apply_payment_intent_payment_failed",
    "record_charge_dispute_opened",
  ];
  const inspected = await postgres.query(
    `select
       p.proname,
       p.prosecdef,
       p.proconfig,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any($1::text[])`,
    [names],
  );
  assert(inspected.rowCount === names.length, "RPC orpheline manquante");
  for (const row of inspected.rows) {
    assert(row.prosecdef === true, `${row.proname}: SECURITY DEFINER absent`);
    assert(
      (row.proconfig ?? []).includes("search_path=pg_catalog, public, pg_temp"),
      `${row.proname}: search_path absent`,
    );
    assert(!row.auth_execute, `${row.proname}: exécutable par authenticated`);
    assert(!row.anon_execute, `${row.proname}: exécutable par anon`);
    assert(row.service_execute, `${row.proname}: service_role absent`);
  }
});

await run("processing orphelin : audit durable, replay dédupliqué, aucun effet financier", async () => {
  const before = await financialSnapshot(tenant.prestataireId);
  const webhook = await claimWebhook(
    "payment_intent.processing",
    tenant.accountId,
  );
  const paymentIntentId = `pi_orphan_processing_${randomUUID()}`;
  const args = {
    p_stripe_event_id: webhook.eventId,
    p_processing_attempt: webhook.attempt,
    p_lease_token: webhook.leaseToken,
    p_connected_account_id: tenant.accountId,
    p_payment_intent_id: paymentIntentId,
    p_tentative_id: randomUUID(),
    p_moyen: "carte",
  };

  const applied = await admin.rpc("apply_payment_intent_processing", args);
  if (applied.error || !applied.data) throw applied.error;
  assert(applied.data.unresolved === true, "processing non signalé orphelin");
  assert(
    applied.data.reconciliation_required === true,
    "processing sans rapprochement requis",
  );

  const replay = await admin.rpc("apply_payment_intent_processing", args);
  if (replay.error || !replay.data) throw replay.error;
  assert(replay.data.reason === "already_applied", "replay processing non dédupliqué");
  assert(
    (await countAudit("PAYMENT_PROCESSING_RECONCILIATION_REQUIRED", webhook.eventId)) === 1,
    "audit processing absent ou dupliqué",
  );
  assert((await countApproval(webhook.eventId)) === 0, "approval processing inattendue");
  assert((await countEffect(webhook.eventId)) === 1, "effet processing non unique");
  assertSameFinancialSnapshot(
    before,
    await financialSnapshot(tenant.prestataireId),
    "processing orphelin",
  );
});

await run("payment_failed orphelin : audit durable, replay dédupliqué, aucun effet financier", async () => {
  const before = await financialSnapshot(tenant.prestataireId);
  const webhook = await claimWebhook(
    "payment_intent.payment_failed",
    tenant.accountId,
  );
  const args = {
    p_stripe_event_id: webhook.eventId,
    p_processing_attempt: webhook.attempt,
    p_lease_token: webhook.leaseToken,
    p_connected_account_id: tenant.accountId,
    p_payment_intent_id: `pi_orphan_failed_${randomUUID()}`,
    p_tentative_id: randomUUID(),
    p_echec_code: "card_declined",
    p_echec_message: "Refus test local",
  };

  const applied = await admin.rpc("apply_payment_intent_payment_failed", args);
  if (applied.error || !applied.data) throw applied.error;
  assert(applied.data.unresolved === true, "échec non signalé orphelin");
  assert(
    applied.data.reconciliation_required === true,
    "échec sans rapprochement requis",
  );

  const replay = await admin.rpc("apply_payment_intent_payment_failed", args);
  if (replay.error || !replay.data) throw replay.error;
  assert(replay.data.reason === "already_applied", "replay échec non dédupliqué");
  assert(
    (await countAudit("PAYMENT_FAILED_RECONCILIATION_REQUIRED", webhook.eventId)) === 1,
    "audit échec absent ou dupliqué",
  );
  const auditMetadata = await postgres.query(
    `select metadata
     from public.audit_log
     where action = 'PAYMENT_FAILED_RECONCILIATION_REQUIRED'
       and metadata ->> 'stripe_event_id' = $1`,
    [webhook.eventId],
  );
  assert(
    auditMetadata.rows[0]?.metadata?.failure_code === "card_declined" &&
      !("failure_message" in auditMetadata.rows[0].metadata),
    "audit échec non minimisé",
  );
  assert((await countApproval(webhook.eventId)) === 0, "approval échec inattendue");
  assert((await countEffect(webhook.eventId)) === 1, "effet échec non unique");
  assertSameFinancialSnapshot(
    before,
    await financialSnapshot(tenant.prestataireId),
    "payment_failed orphelin",
  );
});

await run("dispute orpheline : audit + approval durables, replay dédupliqué, aucun effet financier", async () => {
  const before = await financialSnapshot(tenant.prestataireId);
  const webhook = await claimWebhook("charge.dispute.created", tenant.accountId);
  const args = {
    p_stripe_event_id: webhook.eventId,
    p_processing_attempt: webhook.attempt,
    p_lease_token: webhook.leaseToken,
    p_connected_account_id: tenant.accountId,
    p_dispute_id: `dp_orphan_${randomUUID()}`,
    p_payment_intent_id: `pi_orphan_dispute_${randomUUID()}`,
    p_reason: "fraudulent",
  };

  const applied = await admin.rpc("record_charge_dispute_opened", args);
  if (applied.error || !applied.data) throw applied.error;
  assert(applied.data.unresolved === true, "dispute non signalée orpheline");
  assert(
    applied.data.reconciliation_required === true,
    "dispute sans rapprochement requis",
  );

  const replay = await admin.rpc("record_charge_dispute_opened", args);
  if (replay.error || !replay.data) throw replay.error;
  assert(replay.data.reason === "already_applied", "replay dispute non dédupliqué");
  assert(
    (await countAudit("PAYMENT_DISPUTE_RECONCILIATION_REQUIRED", webhook.eventId)) === 1,
    "audit dispute absent ou dupliqué",
  );
  assert((await countApproval(webhook.eventId)) === 1, "approval dispute absente ou dupliquée");
  assert((await countEffect(webhook.eventId)) === 1, "effet dispute non unique");
  assertSameFinancialSnapshot(
    before,
    await financialSnapshot(tenant.prestataireId),
    "dispute orpheline",
  );
});

await run("fence invalide : aucune trace ni clé d'effet n'est écrite", async () => {
  const webhook = await claimWebhook(
    "payment_intent.processing",
    tenant.accountId,
  );
  const response = await admin.rpc("apply_payment_intent_processing", {
    p_stripe_event_id: webhook.eventId,
    p_processing_attempt: webhook.attempt,
    p_lease_token: randomUUID(),
    p_connected_account_id: tenant.accountId,
    p_payment_intent_id: `pi_stale_lease_${randomUUID()}`,
    p_tentative_id: null,
    p_moyen: "carte",
  });
  assert(
    response.error && /webhook_lease_lost/.test(response.error.message),
    "worker sans lease accepté",
  );
  assert((await countEffect(webhook.eventId)) === 0, "effet écrit avant fence");
  assert((await countApproval(webhook.eventId)) === 0, "approval écrite avant fence");
  const audit = await postgres.query(
    `select count(*)::int as count
     from public.audit_log
     where metadata ->> 'stripe_event_id' = $1`,
    [webhook.eventId],
  );
  assert(audit.rows[0].count === 0, "audit écrit avant fence");
});

await run("compte Connect inconnu : transaction annulée pour chaque objet orphelin", async () => {
  const unknownAccount = `acct_unknown_${randomUUID().replaceAll("-", "")}`;
  const cases = [
    {
      type: "payment_intent.processing",
      rpc: "apply_payment_intent_processing",
      args: {
        p_payment_intent_id: `pi_unknown_processing_${randomUUID()}`,
        p_tentative_id: null,
        p_moyen: "carte",
      },
    },
    {
      type: "payment_intent.payment_failed",
      rpc: "apply_payment_intent_payment_failed",
      args: {
        p_payment_intent_id: `pi_unknown_failed_${randomUUID()}`,
        p_tentative_id: null,
        p_echec_code: "payment_failed",
        p_echec_message: null,
      },
    },
    {
      type: "charge.dispute.created",
      rpc: "record_charge_dispute_opened",
      args: {
        p_dispute_id: `dp_unknown_${randomUUID()}`,
        p_payment_intent_id: `pi_unknown_dispute_${randomUUID()}`,
        p_reason: "other",
      },
    },
  ];

  for (const testCase of cases) {
    const webhook = await claimWebhook(testCase.type, unknownAccount);
    const response = await admin.rpc(testCase.rpc, {
      p_stripe_event_id: webhook.eventId,
      p_processing_attempt: webhook.attempt,
      p_lease_token: webhook.leaseToken,
      p_connected_account_id: unknownAccount,
      ...testCase.args,
    });
    assert(
      response.error && /stripe_account_scope_mismatch/.test(response.error.message),
      `${testCase.type}: scope inconnu non refusé`,
    );
    assert((await countEffect(webhook.eventId)) === 0, `${testCase.type}: effet non rollback`);
    assert((await countApproval(webhook.eventId)) === 0, `${testCase.type}: approval non rollback`);
    const audit = await postgres.query(
      `select count(*)::int as count
       from public.audit_log
       where metadata ->> 'stripe_event_id' = $1`,
      [webhook.eventId],
    );
    assert(audit.rows[0].count === 0, `${testCase.type}: audit non rollback`);
  }
});

await postgres.end();

const failures = results.filter((result) => !result.ok);
console.log(
  `\nSID-STRIPE-003 orphan audit: ${results.length - failures.length}/${results.length} tests réussis.`,
);
if (failures.length > 0) process.exitCode = 1;
