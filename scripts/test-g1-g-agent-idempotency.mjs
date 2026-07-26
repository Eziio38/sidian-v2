#!/usr/bin/env node
/**
 * G1-G — tests SQL / RLS / concurrence réels pour `public.agent_idempotency_records`.
 * Supabase local uniquement (JWT authenticated + service_role + pg).
 *
 * Couverture :
 * 21 deux claims concurrents → un seul acquired
 * 22 aucun double owner actif
 * 23 même clé + fingerprint différent → conflict
 * 24 reprise atomique après expiration
 * 25 ancien owner incapable de terminer après reprise
 * 26 owner courant peut terminer
 * 27 état terminal non réclamé comme nouvelle exécution
 * 28 isolation tenant A / tenant B
 * 29 accès anonyme refusé
 * 30 contraintes SQL actives
 * 31 unicité tenant + idempotency_key
 * 32 aucune course SELECT/INSERT observable (unique_violation + FOR UPDATE)
 *
 * Lancer (migration G1-G appliquée, stack locale up) :
 *   node scripts/test-g1-g-agent-idempotency.mjs
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";

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

const TABLE = "agent_idempotency_records";
const RPC_CLAIM = "claim_idempotency_key";
const RPC_COMPLETE = "complete_idempotency_record";
const RPC_FAIL = "fail_idempotency_record";

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

function hashOwnerToken(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function newOwnerToken() {
  return randomBytes(32).toString("base64url");
}

function fingerprint(suffix) {
  return createHash("sha256")
    .update(`g1g-fp-${suffix}`, "utf8")
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
  const password = "G1G-Idempotency-Local-Password1!";
  const email = `g1g-${label}-${Date.now()}-${randomUUID()}@sidian.test`;
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
      nom: `Agence G1G ${label}`,
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

function claimArgs(tenantId, opts = {}) {
  const token = opts.ownerToken ?? newOwnerToken();
  return {
    token,
    args: {
      p_tenant_id: tenantId,
      p_idempotency_key: opts.key ?? `idem_g1g_${randomUUID()}`,
      p_request_fingerprint: opts.fingerprint ?? fingerprint(randomUUID()),
      p_correlation_id: opts.correlationId ?? `corr_g1g_${randomUUID()}`,
      p_tool_id: opts.toolId ?? "invoice.get",
      p_tool_version: opts.toolVersion ?? "1.0.0",
      p_resource_kind: opts.resourceKind ?? "invoice",
      p_resource_id: opts.resourceId ?? "inv_g1g_rls",
      p_mode: opts.mode ?? "agir",
      p_owner_token_hash: hashOwnerToken(token),
      p_now: opts.now ?? new Date().toISOString(),
      p_ttl_seconds: opts.ttlSeconds ?? 120,
    },
  };
}

async function claim(tenantId, opts = {}) {
  const { token, args } = claimArgs(tenantId, opts);
  const { data, error } = await admin.rpc(RPC_CLAIM, args);
  if (error) throw error;
  return { token, args, data };
}

function successTerminal() {
  return {
    status: "success",
    output_hash: "hash_output_g1g_rls",
    summary: { ok: true },
  };
}

function failureTerminal(code = "EXECUTOR_BUSINESS_ERROR") {
  return {
    status: "failure",
    failure_code: code,
    message: "échec sanitizé g1g",
  };
}

async function complete(recordId, ownerToken, terminal = successTerminal()) {
  const terminalHash = createHash("sha256")
    .update(JSON.stringify(terminal), "utf8")
    .digest("hex");
  const { data, error } = await admin.rpc(RPC_COMPLETE, {
    p_record_id: recordId,
    p_owner_token_hash: hashOwnerToken(ownerToken),
    p_terminal_result: terminal,
    p_terminal_result_hash: terminalHash,
    p_completed_at: new Date().toISOString(),
  });
  if (error) throw error;
  return data;
}

async function fail(recordId, ownerToken, terminal = failureTerminal()) {
  const terminalHash = createHash("sha256")
    .update(JSON.stringify(terminal), "utf8")
    .digest("hex");
  const { data, error } = await admin.rpc(RPC_FAIL, {
    p_record_id: recordId,
    p_owner_token_hash: hashOwnerToken(ownerToken),
    p_terminal_result: terminal,
    p_terminal_result_hash: terminalHash,
    p_failure_code: terminal.failure_code,
    p_completed_at: new Date().toISOString(),
  });
  if (error) throw error;
  return data;
}

await postgres.connect();

let tenantA;
let tenantB;
let tableReady = false;

await run("30a. table agent_idempotency_records existe et RLS activée", async () => {
  const exists = await postgres.query(
    `select c.relrowsecurity as rls_enabled
     from pg_catalog.pg_class as c
     join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = $1`,
    [TABLE],
  );
  assert(
    exists.rowCount === 1,
    "table absente — appliquer la migration G1-G (supabase/migrations/*g1g_agent_idempotency.sql) puis relancer",
  );
  assert(exists.rows[0].rls_enabled === true, "RLS désactivée");
  tableReady = true;
});

if (!tableReady) {
  await postgres.end();
  console.log("");
  console.error(
    "G1-G SQL/RLS: arrêt anticipé — table agent_idempotency_records absente (migration non appliquée).",
  );
  process.exit(1);
}

await run("30. contraintes SQL actives (CHECK / UNIQUE / FK / privileges)", async () => {
  const checks = await postgres.query(
    `select conname
     from pg_catalog.pg_constraint
     where conrelid = 'public.agent_idempotency_records'::regclass
       and contype = 'c'`,
  );
  const checkNames = new Set(checks.rows.map((row) => row.conname));
  for (const name of [
    "agent_idempotency_records_status_ck",
    "agent_idempotency_records_mode_ck",
    "agent_idempotency_records_expires_after_start_ck",
    "agent_idempotency_records_state_ck",
    "agent_idempotency_records_fingerprint_ck",
  ]) {
    assert(checkNames.has(name), `CHECK manquant: ${name}`);
  }

  const unique = await postgres.query(
    `select conname
     from pg_catalog.pg_constraint
     where conrelid = 'public.agent_idempotency_records'::regclass
       and contype = 'u'`,
  );
  const uniqueNames = new Set(unique.rows.map((row) => row.conname));
  assert(
    uniqueNames.has("agent_idempotency_records_tenant_key_uq"),
    "UNIQUE (tenant_id, idempotency_key) absente",
  );

  const fk = await postgres.query(
    `select 1
     from pg_catalog.pg_constraint
     where conrelid = 'public.agent_idempotency_records'::regclass
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

  // CHECK métier : expires_at > started_at
  let expiresBlocked = false;
  try {
    await postgres.query(
      `insert into public.agent_idempotency_records (
         tenant_id, idempotency_key, request_fingerprint, correlation_id,
         tool_id, tool_version, mode, status, owner_token_hash,
         started_at, expires_at
       ) values (
         '00000000-0000-4000-8000-000000000001',
         'idem_ck_expires',
         $1, 'corr_ck', 'invoice.get', '1.0.0', 'agir', 'in_progress',
         $2,
         timezone('utc', now()),
         timezone('utc', now()) - interval '1 second'
       )`,
      [fingerprint("ck"), hashOwnerToken(newOwnerToken())],
    );
  } catch (error) {
    expiresBlocked = /expires_after_start|check constraint/i.test(
      errorMessage(error),
    );
  }
  assert(expiresBlocked, "CHECK expires_at > started_at non appliqué");
});

await run("32. claim atomique — pas de course SELECT/INSERT naïve", async () => {
  const src = await postgres.query(
    `select pg_get_functiondef(p.oid) as def
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = $1`,
    [RPC_CLAIM],
  );
  assert(src.rowCount === 1, "fonction claim_idempotency_key absente");
  const def = src.rows[0].def;
  assert(/unique_violation/i.test(def), "gestion unique_violation absente");
  assert(/for update/i.test(def), "FOR UPDATE absent — sérialisation manquante");
  assert(/insert into public\.agent_idempotency_records/i.test(def), "INSERT claim absent");
  // Anti-pattern classique : SELECT puis INSERT sans gestion de course.
  // On exige le chemin INSERT → exception → SELECT FOR UPDATE.
  const insertIdx = def.toLowerCase().indexOf("insert into public.agent_idempotency_records");
  const forUpdateIdx = def.toLowerCase().indexOf("for update");
  assert(insertIdx >= 0 && forUpdateIdx > insertIdx, "ordre INSERT puis FOR UPDATE attendu");
});

await run("fixtures — deux tenants", async () => {
  tenantA = await createTenant("A");
  tenantB = await createTenant("B");
});

await run("21. deux claims concurrents identiques → un seul acquired", async () => {
  const key = `idem_g1g_concurrent_${randomUUID()}`;
  const fp = fingerprint(key);
  const now = new Date().toISOString();

  const [left, right] = await Promise.all([
    claim(tenantA.prestataireId, { key, fingerprint: fp, now }),
    claim(tenantA.prestataireId, { key, fingerprint: fp, now }),
  ]);

  const decisions = [left.data.decision, right.data.decision].sort();
  assert(
    decisions.includes("acquired") || decisions.includes("expired_reacquired"),
    `aucun claim acquis: ${decisions.join(",")}`,
  );
  assert(
    decisions.includes("in_progress"),
    `second claim non bloqué: ${decisions.join(",")}`,
  );
  assert(
    decisions.filter((d) => d === "acquired" || d === "expired_reacquired")
      .length === 1,
    `plus d’un acquired: ${decisions.join(",")}`,
  );

  const rows = await postgres.query(
    `select id, owner_token_hash, status
     from public.agent_idempotency_records
     where tenant_id = $1 and idempotency_key = $2`,
    [tenantA.prestataireId, key],
  );
  assert(rows.rowCount === 1, `lignes concurrentes: ${rows.rowCount}`);
  assert(rows.rows[0].status === "in_progress", "statut inattendu");
});

await run("22. aucun double owner actif", async () => {
  const key = `idem_g1g_double_owner_${randomUUID()}`;
  const fp = fingerprint(key);
  const first = await claim(tenantA.prestataireId, { key, fingerprint: fp });
  assert(first.data.decision === "acquired", "premier claim");

  const second = await claim(tenantA.prestataireId, { key, fingerprint: fp });
  assert(second.data.decision === "in_progress", "second doit être in_progress");

  const row = await postgres.query(
    `select owner_token_hash from public.agent_idempotency_records
     where tenant_id = $1 and idempotency_key = $2`,
    [tenantA.prestataireId, key],
  );
  assert(row.rowCount === 1, "une seule ligne");
  assert(
    row.rows[0].owner_token_hash === hashOwnerToken(first.token),
    "owner hash écrasé par le second claim",
  );
  assert(
    row.rows[0].owner_token_hash !== hashOwnerToken(second.token),
    "second owner actif indûment",
  );
});

await run("23. même clé + fingerprint différent → conflict", async () => {
  const key = `idem_g1g_conflict_${randomUUID()}`;
  const first = await claim(tenantA.prestataireId, {
    key,
    fingerprint: fingerprint(`${key}-a`),
  });
  assert(first.data.decision === "acquired", "premier claim");

  const second = await claim(tenantA.prestataireId, {
    key,
    fingerprint: fingerprint(`${key}-b`),
  });
  assert(second.data.decision === "conflict", "conflict attendu");
});

await run("24. reprise atomique après expiration", async () => {
  const key = `idem_g1g_expire_${randomUUID()}`;
  const fp = fingerprint(key);
  const first = await claim(tenantA.prestataireId, {
    key,
    fingerprint: fp,
    ttlSeconds: 15,
  });
  assert(first.data.decision === "acquired", "premier claim");

  await postgres.query(
    `update public.agent_idempotency_records
     set started_at = timezone('utc', now()) - interval '2 minutes',
         expires_at = timezone('utc', now()) - interval '1 second'
     where id = $1`,
    [first.data.record_id],
  );

  const reclaim = await claim(tenantA.prestataireId, {
    key,
    fingerprint: fp,
    ttlSeconds: 120,
  });
  assert(
    reclaim.data.decision === "expired_reacquired",
    `reprise attendue, reçu: ${reclaim.data.decision}`,
  );
  assert(reclaim.data.record_id === first.data.record_id, "même record_id");

  const row = await postgres.query(
    `select owner_token_hash, status from public.agent_idempotency_records where id = $1`,
    [first.data.record_id],
  );
  assert(row.rows[0].status === "in_progress", "statut après reprise");
  assert(
    row.rows[0].owner_token_hash === hashOwnerToken(reclaim.token),
    "nouveau owner non installé",
  );
});

await run("25. ancien owner incapable de terminer après reprise", async () => {
  const key = `idem_g1g_old_owner_${randomUUID()}`;
  const fp = fingerprint(key);
  const first = await claim(tenantA.prestataireId, {
    key,
    fingerprint: fp,
    ttlSeconds: 15,
  });
  assert(first.data.decision === "acquired", "premier claim");

  await postgres.query(
    `update public.agent_idempotency_records
     set started_at = timezone('utc', now()) - interval '2 minutes',
         expires_at = timezone('utc', now()) - interval '1 second'
     where id = $1`,
    [first.data.record_id],
  );

  const reclaim = await claim(tenantA.prestataireId, { key, fingerprint: fp });
  assert(reclaim.data.decision === "expired_reacquired", "reprise");

  const oldComplete = await complete(first.data.record_id, first.token);
  assert(oldComplete.ok === false, "ancien owner complete accepté");
  assert(oldComplete.error_code === "owner_mismatch", "owner_mismatch attendu");

  const status = await postgres.query(
    `select status from public.agent_idempotency_records where id = $1`,
    [first.data.record_id],
  );
  assert(status.rows[0].status === "in_progress", "statut muté par ancien owner");
});

await run("26. owner courant peut terminer", async () => {
  const key = `idem_g1g_current_owner_${randomUUID()}`;
  const fp = fingerprint(key);
  const first = await claim(tenantA.prestataireId, { key, fingerprint: fp });
  assert(first.data.decision === "acquired", "claim");

  const done = await complete(first.data.record_id, first.token);
  assert(done.ok === true, "complete owner courant refusé");
  assert(done.status === "succeeded", "status succeeded attendu");

  const row = await postgres.query(
    `select status, owner_token_hash, terminal_result, completed_at
     from public.agent_idempotency_records where id = $1`,
    [first.data.record_id],
  );
  assert(row.rows[0].status === "succeeded", "persist succeeded");
  assert(row.rows[0].owner_token_hash === null, "owner hash non effacé");
  assert(row.rows[0].completed_at !== null, "completed_at manquant");
  assert(row.rows[0].terminal_result?.status === "success", "terminal manquant");
});

await run("27. état terminal non réclamé comme nouvelle exécution", async () => {
  const key = `idem_g1g_terminal_${randomUUID()}`;
  const fp = fingerprint(key);
  const first = await claim(tenantA.prestataireId, { key, fingerprint: fp });
  assert(first.data.decision === "acquired", "claim");
  const done = await complete(first.data.record_id, first.token);
  assert(done.ok === true, "complete");

  const replay = await claim(tenantA.prestataireId, { key, fingerprint: fp });
  assert(
    replay.data.decision === "replay_succeeded",
    `replay attendu, reçu: ${replay.data.decision}`,
  );
  assert(replay.data.terminal_result?.status === "success", "terminal replay");

  // failed terminal
  const keyFail = `idem_g1g_terminal_fail_${randomUUID()}`;
  const fpFail = fingerprint(keyFail);
  const failClaim = await claim(tenantA.prestataireId, {
    key: keyFail,
    fingerprint: fpFail,
  });
  const failed = await fail(failClaim.data.record_id, failClaim.token);
  assert(failed.ok === true, "fail");
  const replayFail = await claim(tenantA.prestataireId, {
    key: keyFail,
    fingerprint: fpFail,
  });
  assert(
    replayFail.data.decision === "replay_failed",
    `replay_failed attendu, reçu: ${replayFail.data.decision}`,
  );
});

await run("28. isolation tenant A / tenant B", async () => {
  const key = `idem_g1g_tenant_iso_${randomUUID()}`;
  const fpA = fingerprint(`${key}-a`);
  const claimA = await claim(tenantA.prestataireId, {
    key,
    fingerprint: fpA,
  });
  assert(claimA.data.decision === "acquired", "claim A");

  // Même clé, autre tenant → claim indépendant (pas de conflit cross-tenant).
  const claimB = await claim(tenantB.prestataireId, {
    key,
    fingerprint: fingerprint(`${key}-b`),
  });
  assert(claimB.data.decision === "acquired", "claim B indépendant");

  const readA = await tenantA.client
    .from(TABLE)
    .select("id, tenant_id, idempotency_key")
    .eq("idempotency_key", key);
  if (readA.error) throw readA.error;
  assert(readA.data?.length === 1, "A doit voir exactement sa ligne");
  assert(readA.data[0].tenant_id === tenantA.prestataireId, "tenant A incohérent");

  const leak = await tenantA.client
    .from(TABLE)
    .select("id")
    .eq("id", claimB.data.record_id);
  if (leak.error) throw leak.error;
  assert((leak.data?.length ?? 0) === 0, "fuite cross-tenant A→B");

  const reverse = await tenantB.client
    .from(TABLE)
    .select("id")
    .eq("id", claimA.data.record_id);
  if (reverse.error) throw reverse.error;
  assert((reverse.data?.length ?? 0) === 0, "fuite cross-tenant B→A");
});

await run("29. accès anonyme refusé (SELECT / INSERT / RPC)", async () => {
  const anon = localClient(LOCAL_DEMO_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const select = await anon.from(TABLE).select("id").limit(1);
  assert(
    select.error || (select.data?.length ?? 0) === 0,
    "SELECT anonyme a renvoyé des lignes",
  );

  const insert = await anon.from(TABLE).insert({
    tenant_id: tenantA.prestataireId,
    idempotency_key: `idem_anon_${randomUUID()}`,
    request_fingerprint: fingerprint("anon"),
    correlation_id: "corr_anon",
    tool_id: "invoice.get",
    tool_version: "1.0.0",
    mode: "agir",
    status: "in_progress",
    owner_token_hash: hashOwnerToken(newOwnerToken()),
    started_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  assert(insert.error, "INSERT anonyme accepté");

  const rpc = await anon.rpc(RPC_CLAIM, claimArgs(tenantA.prestataireId).args);
  assert(rpc.error, "RPC claim anonyme accepté");
});

await run("31. unicité tenant + idempotency_key", async () => {
  const key = `idem_g1g_unique_${randomUUID()}`;
  const fp = fingerprint(key);
  const first = await claim(tenantA.prestataireId, { key, fingerprint: fp });
  assert(first.data.decision === "acquired", "premier insert");

  let uniqueBlocked = false;
  try {
    await postgres.query(
      `insert into public.agent_idempotency_records (
         tenant_id, idempotency_key, request_fingerprint, correlation_id,
         tool_id, tool_version, mode, status, owner_token_hash,
         started_at, expires_at
       ) values (
         $1, $2, $3, 'corr_dup', 'invoice.get', '1.0.0', 'agir', 'in_progress',
         $4, timezone('utc', now()), timezone('utc', now()) + interval '2 minutes'
       )`,
      [
        tenantA.prestataireId,
        key,
        fingerprint("dup"),
        hashOwnerToken(newOwnerToken()),
      ],
    );
  } catch (error) {
    uniqueBlocked = /unique|duplicate|tenant_key_uq/i.test(errorMessage(error));
  }
  assert(uniqueBlocked, "unicité (tenant_id, idempotency_key) non appliquée");

  const count = await postgres.query(
    `select count(*)::int as n from public.agent_idempotency_records
     where tenant_id = $1 and idempotency_key = $2`,
    [tenantA.prestataireId, key],
  );
  assert(count.rows[0].n === 1, "plusieurs lignes pour la même clé");
});

await run("authenticated ne peut pas forger un INSERT direct", async () => {
  const forged = await tenantA.client.from(TABLE).insert({
    tenant_id: tenantA.prestataireId,
    idempotency_key: `idem_auth_${randomUUID()}`,
    request_fingerprint: fingerprint("auth"),
    correlation_id: "corr_auth",
    tool_id: "invoice.get",
    tool_version: "1.0.0",
    mode: "agir",
    status: "in_progress",
    owner_token_hash: hashOwnerToken(newOwnerToken()),
    started_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  assert(forged.error, "INSERT authenticated accepté");
});

await run("terminal_result non sanitizé refusé (stack)", async () => {
  const key = `idem_g1g_unsanitized_${randomUUID()}`;
  const first = await claim(tenantA.prestataireId, {
    key,
    fingerprint: fingerprint(key),
  });
  assert(first.data.decision === "acquired", "claim");

  const { data, error } = await admin.rpc(RPC_COMPLETE, {
    p_record_id: first.data.record_id,
    p_owner_token_hash: hashOwnerToken(first.token),
    p_terminal_result: {
      status: "success",
      output_hash: "hash_x",
      stack: "Error\n    at Object.claim",
    },
    p_terminal_result_hash: fingerprint("unsanitized"),
  });
  assert(
    error || data?.ok === false,
    "terminal avec stack accepté",
  );
  if (error) {
    assert(
      /unsanitized|22023/i.test(errorMessage(error)),
      `erreur inattendue: ${errorMessage(error)}`,
    );
  }
});

await run("G1-J: terminal succeeded immuable (UPDATE service_role refusé)", async () => {
  const key = `idem_g1j_terminal_${randomUUID()}`;
  const fp = fingerprint(key);
  const first = await claim(tenantA.prestataireId, { key, fingerprint: fp });
  assert(first.data.decision === "acquired", "acquired attendu");
  await complete(first.data.record_id, first.token);

  // Mutation qui resterait compatible state_ck (hash seul) — doit être bloquée
  // par le guard terminal G1-J, pas seulement par le CHECK d’état.
  const { error } = await admin
    .from(TABLE)
    .update({
      terminal_result_hash: fingerprint(`mutated_${randomUUID()}`),
    })
    .eq("id", first.data.record_id);
  assert(error, "UPDATE terminal succeeded accepté");
  assert(
    /terminal|23514|check|P0001|violat|agent_idempotency_record/i.test(
      errorMessage(error),
    ),
    `erreur inattendue: ${errorMessage(error)}`,
  );
  const row = await postgres.query(
    `select status, terminal_result_hash from public.agent_idempotency_records where id = $1`,
    [first.data.record_id],
  );
  assert(row.rows[0]?.status === "succeeded", "status terminal muté");
});

await postgres.end();

const failed = results.filter((row) => !row.ok);
console.log("");
console.log(
  `G1-G SQL/RLS/concurrence: ${results.length - failed.length}/${results.length} passés`,
);
if (failed.length > 0) {
  process.exitCode = 1;
}
