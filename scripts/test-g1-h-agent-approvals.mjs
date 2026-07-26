#!/usr/bin/env node
/**
 * G1-H — tests SQL / RLS / concurrence réels pour `public.agent_human_approvals`.
 * Supabase local uniquement (JWT authenticated + service_role + pg).
 *
 * Couverture :
 * 31 deux consommations concurrentes → une seule consumed
 * 32 seconde consommation → already_consumed
 * 33 consommation expirée impossible
 * 34 mauvais tenant impossible
 * 35 mauvais fingerprint impossible
 * 36 mauvais params_hash impossible
 * 37 ancien statut non écrasé (rejected terminal)
 * 38 rejected ne devient jamais approved
 * 39 consumed ne revient jamais approved
 * 40 accès anonyme refusé
 * 41 isolation tenant A / tenant B
 * 42 UPDATE direct applicatif refusé
 * 43 DELETE direct applicatif refusé
 * 44 contraintes SQL actives
 * 45 RPC atomique réellement utilisée (FOR UPDATE + prédicat status)
 *
 * Fail-closed si migration absente :
 *   message clair + exit 1 (pas de faux PASS).
 *
 * Lancer (migration G1-H appliquée, stack locale up) :
 *   node scripts/test-g1-h-agent-approvals.mjs
 *   # ou : node scripts/test-local-supabase-guard.mjs && node scripts/test-g1-h-agent-approvals.mjs
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

const TABLE = "agent_human_approvals";
const RPC_CREATE = "create_human_approval";
const RPC_DECIDE = "decide_human_approval";
const RPC_CONSUME = "consume_human_approval";
const RPC_STATUS = "get_human_approval_status";

const localConfig = assertLocalTestConfig();
const SUPABASE_URL = localConfig.url;

function localClient(key, options = {}) {
  return createClient(SUPABASE_URL, key, withLocalOnlyFetch(options));
}

const admin = localClient(LOCAL_DEMO_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const postgres = createLocalPgClient(resolveLocalPostgresUrl(), pg);

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

function fingerprint(suffix) {
  return createHash("sha256")
    .update(`g1h-fp-${suffix}`, "utf8")
    .digest("hex");
}

function paramsHash(suffix) {
  return createHash("sha256")
    .update(`g1h-params-${suffix}`, "utf8")
    .digest("hex");
}

function idempotencyKeyHash(suffix) {
  return createHash("sha256")
    .update(`g1h-idem-${suffix}`, "utf8")
    .digest("hex");
}

async function run(name, test) {
  try {
    await test();
    results.push({ name, ok: true });
    console.log(`✓ ${name}`);
  } catch (error) {
    const message = errorMessage(error);
    results.push({ name, ok: false, message });
    console.error(`✗ ${name}: ${message}`);
  }
}

async function createTenant(label) {
  const password = "G1H-Approvals-Local-Password1!";
  const email = `g1h-${label}-${Date.now()}-${randomUUID()}@sidian.test`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error("auth_user_creation_failed");
  }

  const prestataire = await admin
    .from("prestataire")
    .insert({
      user_id: created.data.user.id,
      nom: `Agence G1H ${label}`,
      email,
    })
    .select("id")
    .single();
  if (prestataire.error || !prestataire.data) {
    throw prestataire.error ?? new Error("prestataire_creation_failed");
  }

  const auth = localClient(LOCAL_DEMO_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signedIn = await auth.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session) {
    throw signedIn.error ?? new Error("auth_sign_in_failed");
  }

  return {
    client: localClient(LOCAL_DEMO_ANON_KEY, {
      global: {
        headers: {
          Authorization: `Bearer ${signedIn.data.session.access_token}`,
        },
      },
      auth: { autoRefreshToken: false, persistSession: false },
    }),
    prestataireId: prestataire.data.id,
    userId: created.data.user.id,
  };
}

function createArgs(tenantId, opts = {}) {
  const suffix = opts.suffix ?? randomUUID();
  return {
    p_tenant_id: tenantId,
    p_request_fingerprint: opts.fingerprint ?? fingerprint(suffix),
    p_params_hash: opts.paramsHash ?? paramsHash(suffix),
    p_tool_id: opts.toolId ?? "invoice.send_reminder",
    p_tool_version: opts.toolVersion ?? "1.0.0",
    p_mode: opts.mode ?? "agir",
    p_requested_autonomy_level: opts.autonomy ?? 2,
    p_resource_kind: opts.resourceKind ?? "invoice",
    p_resource_id: opts.resourceId ?? "inv_g1h_rls",
    p_requester_actor_id: opts.requesterActorId ?? "system_g1h",
    p_requester_actor_type: opts.requesterActorType ?? "system",
    p_now: opts.now ?? new Date().toISOString(),
    p_expires_at: opts.expiresAt ?? null,
    p_ttl_seconds: opts.ttlSeconds ?? (opts.expiresAt ? null : 3600),
  };
}

async function createApproval(tenantId, opts = {}) {
  const args = createArgs(tenantId, opts);
  const { data, error } = await admin.rpc(RPC_CREATE, args);
  if (error) throw error;
  return { args, data };
}

async function decideApproval(approvalId, tenantId, decision = "approve", opts = {}) {
  const { data, error } = await admin.rpc(RPC_DECIDE, {
    p_approval_id: approvalId,
    p_tenant_id: tenantId,
    p_decision: decision,
    p_decided_by_actor_id: opts.actorId ?? "human_decider_g1h",
    p_decision_reason_code: opts.reason ?? "approved_for_test",
    p_now: opts.now ?? new Date().toISOString(),
  });
  if (error) throw error;
  return data;
}

function consumeArgs(approvalId, tenantId, createPayload, opts = {}) {
  return {
    p_approval_id: approvalId,
    p_tenant_id: tenantId,
    p_request_fingerprint:
      opts.fingerprint ?? createPayload.p_request_fingerprint,
    p_params_hash: opts.paramsHash ?? createPayload.p_params_hash,
    p_tool_id: opts.toolId ?? createPayload.p_tool_id,
    p_tool_version: opts.toolVersion ?? createPayload.p_tool_version,
    p_mode: opts.mode ?? createPayload.p_mode,
    p_requested_autonomy_level:
      opts.autonomy ?? createPayload.p_requested_autonomy_level,
    p_resource_kind: opts.resourceKind ?? createPayload.p_resource_kind,
    p_resource_id: opts.resourceId ?? createPayload.p_resource_id,
    p_correlation_id: opts.correlationId ?? `corr_g1h_${randomUUID()}`,
    p_idempotency_key_hash:
      opts.idempotencyKeyHash ?? idempotencyKeyHash(randomUUID()),
    p_now: opts.now ?? new Date().toISOString(),
  };
}

async function consumeApproval(approvalId, tenantId, createPayload, opts = {}) {
  const args = consumeArgs(approvalId, tenantId, createPayload, opts);
  const { data, error } = await admin.rpc(RPC_CONSUME, args);
  if (error) throw error;
  return { args, data };
}

await postgres.connect();

let tenantA;
let tenantB;
let tableReady = false;

await run("44a. table agent_human_approvals existe et RLS activée", async () => {
  const exists = await postgres.query(
    `select c.relrowsecurity as rls_enabled
     from pg_catalog.pg_class as c
     join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = $1`,
    [TABLE],
  );
  assert(
    exists.rowCount === 1,
    "table absente — appliquer la migration G1-H (supabase/migrations/*g1h_human_approvals.sql) puis relancer",
  );
  assert(exists.rows[0].rls_enabled === true, "RLS désactivée");
  tableReady = true;
});

if (!tableReady) {
  await postgres.end();
  console.log("");
  console.error(
    "G1-H SQL/RLS: arrêt anticipé fail-closed — table agent_human_approvals absente (migration non appliquée en local).",
  );
  console.error(
    "Action: supabase db reset (ou appliquer 20260724240000_g1h_human_approvals.sql) puis relancer scripts/test-g1-h-agent-approvals.mjs",
  );
  process.exit(1);
}

await run("44. contraintes SQL actives (CHECK / FK / privileges)", async () => {
  const checks = await postgres.query(
    `select conname
     from pg_catalog.pg_constraint
     where conrelid = 'public.agent_human_approvals'::regclass
       and contype = 'c'`,
  );
  const checkNames = new Set(checks.rows.map((row) => row.conname));
  for (const name of [
    "agent_human_approvals_status_ck",
    "agent_human_approvals_mode_ck",
    "agent_human_approvals_expires_after_requested_ck",
    "agent_human_approvals_state_ck",
    "agent_human_approvals_fingerprint_ck",
    "agent_human_approvals_autonomy_ck",
  ]) {
    assert(checkNames.has(name), `CHECK manquant: ${name}`);
  }

  const fk = await postgres.query(
    `select 1
     from pg_catalog.pg_constraint
     where conrelid = 'public.agent_human_approvals'::regclass
       and contype = 'f'
       and conname like '%tenant_id%'
     limit 1`,
  );
  assert(fk.rowCount === 1, "FK tenant_id absente");

  const privileges = await postgres.query(
    `select
       has_table_privilege('authenticated', $1, 'SELECT') as auth_select,
       has_table_privilege('authenticated', $1, 'INSERT') as auth_insert,
       has_table_privilege('authenticated', $1, 'UPDATE') as auth_update,
       has_table_privilege('authenticated', $1, 'DELETE') as auth_delete,
       has_table_privilege('anon', $1, 'SELECT') as anon_select,
       has_table_privilege('anon', $1, 'INSERT') as anon_insert,
       has_table_privilege('service_role', $1, 'SELECT') as srv_select,
       has_table_privilege('service_role', $1, 'INSERT') as srv_insert,
       has_table_privilege('service_role', $1, 'UPDATE') as srv_update,
       has_table_privilege('service_role', $1, 'DELETE') as srv_delete`,
    [`public.${TABLE}`],
  );
  const acl = privileges.rows[0];
  assert(acl.auth_select === true, "authenticated SELECT absent");
  assert(acl.auth_insert === false, "authenticated INSERT résiduel");
  assert(acl.auth_update === false, "authenticated UPDATE résiduel");
  assert(acl.auth_delete === false, "authenticated DELETE résiduel");
  assert(acl.anon_select === false, "anon SELECT résiduel");
  assert(acl.anon_insert === false, "anon INSERT résiduel");
  assert(acl.srv_select === true, "service_role SELECT absent");
  assert(acl.srv_insert === true, "service_role INSERT absent");
  assert(acl.srv_update === true, "service_role UPDATE absent");
  assert(acl.srv_delete === false, "service_role DELETE résiduel");

  let expiresBlocked = false;
  try {
    await postgres.query(
      `insert into public.agent_human_approvals (
         tenant_id, request_fingerprint, params_hash,
         tool_id, tool_version, mode, requested_autonomy_level,
         requester_actor_id, requester_actor_type, status,
         requested_at, expires_at
       ) values (
         '00000000-0000-4000-8000-000000000001',
         $1, $2,
         'invoice.send_reminder', '1.0.0', 'agir', 2,
         'system', 'system', 'pending',
         timezone('utc', now()),
         timezone('utc', now()) - interval '1 second'
       )`,
      [fingerprint("ck"), paramsHash("ck")],
    );
  } catch (error) {
    expiresBlocked = /expires_after_requested|check constraint|foreign key/i.test(
      errorMessage(error),
    );
  }
  assert(expiresBlocked, "CHECK expires_at > requested_at non appliqué");
});

await run("45. RPC atomique réellement utilisée (FOR UPDATE + status='approved')", async () => {
  const src = await postgres.query(
    `select pg_get_functiondef(p.oid) as def
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = $1`,
    [RPC_CONSUME],
  );
  assert(src.rowCount === 1, "fonction consume_human_approval absente");
  const def = src.rows[0].def;
  assert(/for update/i.test(def), "FOR UPDATE absent — sérialisation manquante");
  assert(
    /status\s*=\s*'approved'/i.test(def),
    "prédicat status='approved' absent sur UPDATE consume",
  );
  assert(
    /already_consumed/i.test(def),
    "résultat already_consumed absent",
  );
  // Anti-pattern : pas de simple SELECT client puis UPDATE hors RPC.
  assert(
    /update public\.agent_human_approvals/i.test(def),
    "UPDATE atomique consume absent",
  );

  const decideSrc = await postgres.query(
    `select pg_get_functiondef(p.oid) as def
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = $1`,
    [RPC_DECIDE],
  );
  assert(decideSrc.rowCount === 1, "fonction decide_human_approval absente");
  assert(/for update/i.test(decideSrc.rows[0].def), "FOR UPDATE decide absent");

  const createSrc = await postgres.query(
    `select 1
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = $1`,
    [RPC_CREATE],
  );
  assert(createSrc.rowCount >= 1, "fonction create_human_approval absente");

  const statusSrc = await postgres.query(
    `select 1
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = $1`,
    [RPC_STATUS],
  );
  assert(statusSrc.rowCount >= 1, "fonction get_human_approval_status absente");
});

await run("fixtures — deux tenants", async () => {
  tenantA = await createTenant("A");
  tenantB = await createTenant("B");
});

await run("31. deux consommations concurrentes → exactement une consumed", async () => {
  const created = await createApproval(tenantA.prestataireId);
  assert(created.data?.ok === true, "create");
  const decided = await decideApproval(
    created.data.approval_id,
    tenantA.prestataireId,
  );
  assert(decided?.ok === true, "decide approve");
  assert(decided?.status === "approved", "status approved");

  const [left, right] = await Promise.all([
    consumeApproval(
      created.data.approval_id,
      tenantA.prestataireId,
      created.args,
    ),
    consumeApproval(
      created.data.approval_id,
      tenantA.prestataireId,
      created.args,
    ),
  ]);

  const outcomes = [left.data.result, right.data.result].sort();
  assert(
    outcomes.includes("consumed"),
    `aucun consumed: ${outcomes.join(",")}`,
  );
  assert(
    outcomes.includes("already_consumed"),
    `second non already_consumed: ${outcomes.join(",")}`,
  );
  assert(
    outcomes.filter((o) => o === "consumed").length === 1,
    `plus d’un consumed: ${outcomes.join(",")}`,
  );

  const row = await postgres.query(
    `select status, consumed_at, consumed_by_correlation_id
     from public.agent_human_approvals where approval_id = $1`,
    [created.data.approval_id],
  );
  assert(row.rows[0].status === "consumed", "statut final ≠ consumed");
  assert(row.rows[0].consumed_at !== null, "consumed_at manquant");
  assert(
    row.rows[0].consumed_by_correlation_id !== null,
    "correlation manquante",
  );
});

await run("32. seconde consommation → already_consumed", async () => {
  const created = await createApproval(tenantA.prestataireId);
  await decideApproval(created.data.approval_id, tenantA.prestataireId);
  const first = await consumeApproval(
    created.data.approval_id,
    tenantA.prestataireId,
    created.args,
  );
  assert(first.data.result === "consumed", "premier consume");

  const second = await consumeApproval(
    created.data.approval_id,
    tenantA.prestataireId,
    created.args,
  );
  assert(
    second.data.result === "already_consumed",
    `already_consumed attendu, reçu: ${second.data.result}`,
  );
});

await run("33. consommation expirée impossible", async () => {
  const created = await createApproval(tenantA.prestataireId, {
    ttlSeconds: 60,
  });
  await decideApproval(created.data.approval_id, tenantA.prestataireId);

  // Force expiration sans muter les champs immuables via le trigger :
  // le trigger bloque expires_at — on passe p_now futur à la RPC.
  const future = new Date(Date.now() + 120_000).toISOString();
  const expired = await consumeApproval(
    created.data.approval_id,
    tenantA.prestataireId,
    created.args,
    { now: future },
  );
  assert(
    expired.data.result === "expired",
    `expired attendu, reçu: ${expired.data.result}`,
  );

  const row = await postgres.query(
    `select status from public.agent_human_approvals where approval_id = $1`,
    [created.data.approval_id],
  );
  assert(row.rows[0].status === "expired", "statut non passé à expired");
});

await run("34. mauvais tenant impossible", async () => {
  const created = await createApproval(tenantA.prestataireId);
  await decideApproval(created.data.approval_id, tenantA.prestataireId);

  const wrong = await consumeApproval(
    created.data.approval_id,
    tenantB.prestataireId,
    created.args,
  );
  assert(
    wrong.data.result === "not_found",
    `not_found attendu, reçu: ${wrong.data.result}`,
  );

  const row = await postgres.query(
    `select status from public.agent_human_approvals where approval_id = $1`,
    [created.data.approval_id],
  );
  assert(row.rows[0].status === "approved", "statut muté par mauvais tenant");
});

await run("35. mauvais fingerprint impossible", async () => {
  const created = await createApproval(tenantA.prestataireId);
  await decideApproval(created.data.approval_id, tenantA.prestataireId);

  const mismatch = await consumeApproval(
    created.data.approval_id,
    tenantA.prestataireId,
    created.args,
    { fingerprint: fingerprint("other") },
  );
  assert(
    mismatch.data.result === "scope_mismatch",
    `scope_mismatch attendu, reçu: ${mismatch.data.result}`,
  );
});

await run("36. mauvais params_hash impossible", async () => {
  const created = await createApproval(tenantA.prestataireId);
  await decideApproval(created.data.approval_id, tenantA.prestataireId);

  const mismatch = await consumeApproval(
    created.data.approval_id,
    tenantA.prestataireId,
    created.args,
    { paramsHash: paramsHash("other") },
  );
  assert(
    mismatch.data.result === "params_mismatch",
    `params_mismatch attendu, reçu: ${mismatch.data.result}`,
  );
});

await run("37. ancien statut non écrasé (rejected reste rejected)", async () => {
  const created = await createApproval(tenantA.prestataireId);
  const rejected = await decideApproval(
    created.data.approval_id,
    tenantA.prestataireId,
    "reject",
  );
  assert(rejected?.status === "rejected", "reject");

  const retryApprove = await decideApproval(
    created.data.approval_id,
    tenantA.prestataireId,
    "approve",
  );
  assert(
    retryApprove?.ok === false,
    "re-approve accepté sur rejected",
  );

  const row = await postgres.query(
    `select status, decided_by_actor_id from public.agent_human_approvals
     where approval_id = $1`,
    [created.data.approval_id],
  );
  assert(row.rows[0].status === "rejected", "statut rejected écrasé");
});

await run("38. rejected ne devient jamais approved (guard + RPC)", async () => {
  const created = await createApproval(tenantA.prestataireId);
  await decideApproval(
    created.data.approval_id,
    tenantA.prestataireId,
    "reject",
  );

  let guardBlocked = false;
  try {
    await postgres.query(
      `update public.agent_human_approvals
       set status = 'approved',
           decided_at = timezone('utc', now()),
           decided_by_actor_id = 'forged'
       where approval_id = $1`,
      [created.data.approval_id],
    );
  } catch (error) {
    guardBlocked = /terminal|rejected_cannot_approve|transition/i.test(
      errorMessage(error),
    );
  }
  assert(guardBlocked, "guard transition rejected→approved non appliqué");

  const row = await postgres.query(
    `select status from public.agent_human_approvals where approval_id = $1`,
    [created.data.approval_id],
  );
  assert(row.rows[0].status === "rejected", "rejected devenu approved");
});

await run("39. consumed ne revient jamais approved", async () => {
  const created = await createApproval(tenantA.prestataireId);
  await decideApproval(created.data.approval_id, tenantA.prestataireId);
  const consumed = await consumeApproval(
    created.data.approval_id,
    tenantA.prestataireId,
    created.args,
  );
  assert(consumed.data.result === "consumed", "consume");

  let guardBlocked = false;
  try {
    await postgres.query(
      `update public.agent_human_approvals
       set status = 'approved',
           consumed_at = null,
           consumed_by_correlation_id = null,
           consumed_idempotency_key_hash = null
       where approval_id = $1`,
      [created.data.approval_id],
    );
  } catch (error) {
    guardBlocked = /terminal|transition/i.test(errorMessage(error));
  }
  assert(guardBlocked, "guard consumed→approved non appliqué");

  const row = await postgres.query(
    `select status from public.agent_human_approvals where approval_id = $1`,
    [created.data.approval_id],
  );
  assert(row.rows[0].status === "consumed", "consumed réactivé");
});

await run("40. accès anonyme refusé (SELECT / INSERT / RPC)", async () => {
  const anon = localClient(LOCAL_DEMO_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const select = await anon.from(TABLE).select("approval_id").limit(1);
  assert(
    select.error || (select.data?.length ?? 0) === 0,
    "SELECT anonyme a renvoyé des lignes",
  );

  const insert = await anon.from(TABLE).insert({
    tenant_id: tenantA.prestataireId,
    request_fingerprint: fingerprint("anon"),
    params_hash: paramsHash("anon"),
    tool_id: "invoice.send_reminder",
    tool_version: "1.0.0",
    mode: "agir",
    requested_autonomy_level: 2,
    requester_actor_id: "anon",
    requester_actor_type: "human",
    status: "pending",
    requested_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  assert(insert.error, "INSERT anonyme accepté");

  const rpc = await anon.rpc(RPC_CREATE, createArgs(tenantA.prestataireId));
  assert(rpc.error, "RPC create anonyme accepté");
});

await run("41. isolation tenant A / tenant B", async () => {
  const createdA = await createApproval(tenantA.prestataireId);
  const createdB = await createApproval(tenantB.prestataireId);

  const readA = await tenantA.client
    .from(TABLE)
    .select("approval_id, tenant_id")
    .eq("approval_id", createdA.data.approval_id);
  if (readA.error) throw readA.error;
  assert(readA.data?.length === 1, "A doit voir sa ligne");
  assert(
    readA.data[0].tenant_id === tenantA.prestataireId,
    "tenant A incohérent",
  );

  const leak = await tenantA.client
    .from(TABLE)
    .select("approval_id")
    .eq("approval_id", createdB.data.approval_id);
  if (leak.error) throw leak.error;
  assert((leak.data?.length ?? 0) === 0, "fuite cross-tenant A→B");

  const reverse = await tenantB.client
    .from(TABLE)
    .select("approval_id")
    .eq("approval_id", createdA.data.approval_id);
  if (reverse.error) throw reverse.error;
  assert((reverse.data?.length ?? 0) === 0, "fuite cross-tenant B→A");
});

await run("42. UPDATE direct applicatif (authenticated) refusé", async () => {
  const created = await createApproval(tenantA.prestataireId);
  const forged = await tenantA.client
    .from(TABLE)
    .update({ status: "approved" })
    .eq("approval_id", created.data.approval_id)
    .select("approval_id");
  assert(
    forged.error || (forged.data?.length ?? 0) === 0,
    "UPDATE authenticated accepté",
  );

  const row = await postgres.query(
    `select status from public.agent_human_approvals where approval_id = $1`,
    [created.data.approval_id],
  );
  assert(row.rows[0].status === "pending", "statut muté hors RPC");
});

await run("43. DELETE direct applicatif (authenticated + service_role) refusé", async () => {
  const created = await createApproval(tenantA.prestataireId);

  const authDelete = await tenantA.client
    .from(TABLE)
    .delete()
    .eq("approval_id", created.data.approval_id)
    .select("approval_id");
  assert(
    authDelete.error || (authDelete.data?.length ?? 0) === 0,
    "DELETE authenticated accepté",
  );

  const srvDelete = await admin
    .from(TABLE)
    .delete()
    .eq("approval_id", created.data.approval_id)
    .select("approval_id");
  assert(
    srvDelete.error || (srvDelete.data?.length ?? 0) === 0,
    "DELETE service_role accepté",
  );

  const row = await postgres.query(
    `select 1 from public.agent_human_approvals where approval_id = $1`,
    [created.data.approval_id],
  );
  assert(row.rowCount === 1, "ligne supprimée indûment");
});

await postgres.end();

const failed = results.filter((row) => !row.ok);
console.log("");
console.log(
  `G1-H SQL/RLS/concurrence: ${results.length - failed.length}/${results.length} passés`,
);
if (failed.length > 0) {
  process.exitCode = 1;
}
