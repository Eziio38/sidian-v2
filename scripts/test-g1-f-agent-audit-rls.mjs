#!/usr/bin/env node
/**
 * G1-F — tests SQL/RLS réels pour `public.agent_audit_events`.
 * Supabase local uniquement (JWT authenticated + service_role + pg).
 *
 * Couverture :
 * 16 tenant A ne lit pas tenant B
 * 17 tenant A lit son tenant
 * 18 UPDATE applicatif refusé
 * 19 DELETE applicatif refusé
 * 20 accès anonyme refusé
 * 21 index / contraintes / privileges / RLS
 *
 * Lancer (migration G1-F appliquée, stack locale up) :
 *   node scripts/test-g1-f-agent-audit-rls.mjs
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

const TABLE = "agent_audit_events";
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
  const password = "G1F-Audit-Local-Password1!";
  const email = `g1f-${label}-${Date.now()}-${randomUUID()}@sidian.test`;
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
      nom: `Agence G1F ${label}`,
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

function buildAuditRow(tenantId, suffix) {
  const auditId = `aud_g1f_${suffix.replaceAll("-", "").slice(0, 24)}`;
  return {
    audit_id: auditId,
    schema_version: "1",
    occurred_at: "2026-07-24T12:00:00.000Z",
    correlation_id: `corr_g1f_${suffix}`,
    tenant_id: tenantId,
    actor_id: "actor_g1f_rls",
    actor_type: "human",
    tool_id: "invoice.get",
    tool_version: "1.0.0",
    mode: "agir",
    requested_autonomy_level: 1,
    decision: "allow",
    result_status: "success",
    reason_code: "SUCCESS",
    resource_kind: "invoice",
    resource_id: "inv_g1f_rls",
    params_hash: "hash_params_g1f_rls",
    output_hash: "hash_output_g1f_rls",
    executor_id: "executor_g1f_rls",
    event_payload: {
      audit_id: auditId,
      timestamp: "2026-07-24T12:00:00.000Z",
      correlation_id: `corr_g1f_${suffix}`,
      tenant: { tenant_id: tenantId },
      actor: { actor_id: "actor_g1f_rls", actor_type: "human" },
      tool: { tool_id: "invoice.get", tool_version: "1.0.0" },
      mode: "agir",
      autonomy: { requested: 1, maximum: 1 },
      decision: "allow",
      result: "success",
      reason_code: "SUCCESS",
      duration_ms: 1,
      params_hash: "hash_params_g1f_rls",
      executor: "executor_g1f_rls",
      output_hash: "hash_output_g1f_rls",
    },
  };
}

await postgres.connect();

let tenantA;
let tenantB;
let rowA;
let rowB;
let tableReady = false;

await run("21a. table agent_audit_events existe et RLS activée", async () => {
  const exists = await postgres.query(
    `select c.relrowsecurity as rls_enabled
     from pg_catalog.pg_class as c
     join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = $1`,
    [TABLE],
  );
  assert(
    exists.rowCount === 1,
    "table absente — appliquer la migration G1-F (supabase/migrations/*g1f_agent_audit_events.sql) puis relancer",
  );
  assert(exists.rows[0].rls_enabled === true, "RLS désactivée");
  tableReady = true;
});

if (!tableReady) {
  await postgres.end();
  console.log("");
  console.error(
    "G1-F RLS: arrêt anticipé — table agent_audit_events absente (migration non appliquée).",
  );
  process.exit(1);
}

await run("21b. index attendus présents", async () => {
  const expected = [
    "agent_audit_events_tenant_occurred_at_idx",
    "agent_audit_events_correlation_id_idx",
    "agent_audit_events_tool_occurred_at_idx",
  ];
  const indexes = await postgres.query(
    `select indexname
     from pg_catalog.pg_indexes
     where schemaname = 'public' and tablename = $1`,
    [TABLE],
  );
  const names = new Set(indexes.rows.map((row) => row.indexname));
  for (const name of expected) {
    assert(names.has(name), `index manquant: ${name}`);
  }
  assert(names.has(`${TABLE}_pkey`), "PK absente");
});

await run("21c. contraintes CHECK / FK / privileges attendus", async () => {
  const checks = await postgres.query(
    `select conname
     from pg_catalog.pg_constraint
     where conrelid = 'public.agent_audit_events'::regclass
       and contype = 'c'`,
  );
  const checkNames = new Set(checks.rows.map((row) => row.conname));
  for (const name of [
    "agent_audit_events_decision_ck",
    "agent_audit_events_result_status_ck",
    "agent_audit_events_actor_type_ck",
    "agent_audit_events_reason_code_ck",
  ]) {
    assert(checkNames.has(name), `CHECK manquant: ${name}`);
  }

  const reasonCheck = await postgres.query(
    `select pg_get_constraintdef(oid) as def
     from pg_catalog.pg_constraint
     where conrelid = 'public.agent_audit_events'::regclass
       and conname = 'agent_audit_events_reason_code_ck'`,
  );
  const reasonDef = reasonCheck.rows[0]?.def ?? "";
  for (const code of [
    "APPROVAL_AUTONOMY_MISMATCH",
    "IDEMPOTENCY_KEY_CONFLICT",
    "AUDIT_BUILD_FAILED",
  ]) {
    assert(
      reasonDef.includes(`'${code}'`),
      `reason_code CHECK sans ${code} (appliquer migration G1-J)`,
    );
  }

  const fk = await postgres.query(
    `select 1
     from pg_catalog.pg_constraint
     where conrelid = 'public.agent_audit_events'::regclass
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
       has_table_privilege('authenticated', $1, 'TRUNCATE') as auth_truncate,
       has_table_privilege('anon', $1, 'SELECT') as anon_select,
       has_table_privilege('anon', $1, 'INSERT') as anon_insert,
       has_table_privilege('service_role', $1, 'SELECT') as srv_select,
       has_table_privilege('service_role', $1, 'INSERT') as srv_insert,
       has_table_privilege('service_role', $1, 'UPDATE') as srv_update,
       has_table_privilege('service_role', $1, 'DELETE') as srv_delete,
       has_table_privilege('service_role', $1, 'TRUNCATE') as srv_truncate`,
    [`public.${TABLE}`],
  );
  const acl = privileges.rows[0];
  assert(acl.auth_select === true, "authenticated SELECT absent");
  assert(acl.auth_insert === false, "authenticated INSERT résiduel");
  assert(acl.auth_update === false, "authenticated UPDATE résiduel");
  assert(acl.auth_delete === false, "authenticated DELETE résiduel");
  assert(acl.auth_truncate === false, "authenticated TRUNCATE résiduel");
  assert(acl.anon_select === false, "anon SELECT résiduel");
  assert(acl.anon_insert === false, "anon INSERT résiduel");
  assert(acl.srv_select === true, "service_role SELECT absent");
  assert(acl.srv_insert === true, "service_role INSERT absent");
  assert(acl.srv_update === false, "service_role UPDATE résiduel");
  assert(acl.srv_delete === false, "service_role DELETE résiduel");
  assert(acl.srv_truncate === false, "service_role TRUNCATE résiduel");

  const dmlPolicies = await postgres.query(
    `select p.polname
     from pg_catalog.pg_policy as p
     join pg_catalog.pg_class as c on c.oid = p.polrelid
     join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = $1
       and p.polcmd in ('a', 'w', 'd')`,
    [TABLE],
  );
  assert(dmlPolicies.rowCount === 0, "policy DML applicative résiduelle");
});

await run("fixtures service_role — deux tenants + deux événements", async () => {
  tenantA = await createTenant("A");
  tenantB = await createTenant("B");

  const insertA = await admin
    .from(TABLE)
    .insert(buildAuditRow(tenantA.prestataireId, randomUUID()))
    .select("audit_id, tenant_id")
    .single();
  if (insertA.error || !insertA.data) {
    throw insertA.error ?? new Error("insert_tenant_a_failed");
  }
  rowA = insertA.data;

  const insertB = await admin
    .from(TABLE)
    .insert(buildAuditRow(tenantB.prestataireId, randomUUID()))
    .select("audit_id, tenant_id")
    .single();
  if (insertB.error || !insertB.data) {
    throw insertB.error ?? new Error("insert_tenant_b_failed");
  }
  rowB = insertB.data;
});

await run("17. tenant A lit son tenant", async () => {
  const own = await tenantA.client
    .from(TABLE)
    .select("audit_id, tenant_id")
    .eq("audit_id", rowA.audit_id);
  if (own.error) throw own.error;
  assert(own.data?.length === 1, "ligne propre invisible");
  assert(own.data[0].tenant_id === tenantA.prestataireId, "tenant_id incohérent");
});

await run("16. tenant A ne lit pas tenant B", async () => {
  const foreign = await tenantA.client
    .from(TABLE)
    .select("audit_id")
    .eq("audit_id", rowB.audit_id);
  if (foreign.error) throw foreign.error;
  assert(foreign.data?.length === 0, "fuite cross-tenant A→B");

  const reverse = await tenantB.client
    .from(TABLE)
    .select("audit_id")
    .eq("audit_id", rowA.audit_id);
  if (reverse.error) throw reverse.error;
  assert(reverse.data?.length === 0, "fuite cross-tenant B→A");
});

await run("18. UPDATE applicatif refusé (authenticated + service_role)", async () => {
  const authUpdate = await tenantA.client
    .from(TABLE)
    .update({ reason_code: "ALLOW" })
    .eq("audit_id", rowA.audit_id)
    .select("audit_id");
  assert(authUpdate.error || (authUpdate.data?.length ?? 0) === 0, "UPDATE authenticated accepté");

  // Même avec service_role : trigger append-only doit bloquer.
  let triggerBlocked = false;
  try {
    await postgres.query(
      `update public.agent_audit_events
       set reason_code = 'ALLOW'
       where audit_id = $1`,
      [rowA.audit_id],
    );
  } catch (error) {
    triggerBlocked = /agent_audit_events_immutable|42501/i.test(
      errorMessage(error),
    );
  }
  assert(triggerBlocked, "UPDATE serveur non bloqué par trigger");

  const unchanged = await postgres.query(
    `select reason_code from public.agent_audit_events where audit_id = $1`,
    [rowA.audit_id],
  );
  assert(unchanged.rows[0]?.reason_code === "SUCCESS", "reason_code muté");
});

await run("19. DELETE applicatif refusé (authenticated + trigger)", async () => {
  const authDelete = await tenantA.client
    .from(TABLE)
    .delete()
    .eq("audit_id", rowA.audit_id)
    .select("audit_id");
  assert(authDelete.error || (authDelete.data?.length ?? 0) === 0, "DELETE authenticated accepté");

  let triggerBlocked = false;
  try {
    await postgres.query(
      `delete from public.agent_audit_events where audit_id = $1`,
      [rowA.audit_id],
    );
  } catch (error) {
    triggerBlocked = /agent_audit_events_immutable|42501/i.test(
      errorMessage(error),
    );
  }
  assert(triggerBlocked, "DELETE serveur non bloqué par trigger");

  const stillThere = await postgres.query(
    `select 1 from public.agent_audit_events where audit_id = $1`,
    [rowA.audit_id],
  );
  assert(stillThere.rowCount === 1, "ligne supprimée malgré trigger");
});

await run("20. accès anonyme refusé (SELECT / INSERT)", async () => {
  const anon = localClient(LOCAL_DEMO_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const select = await anon.from(TABLE).select("audit_id").limit(1);
  assert(
    select.error || (select.data?.length ?? 0) === 0,
    "SELECT anonyme a renvoyé des lignes",
  );

  const insert = await anon.from(TABLE).insert(
    buildAuditRow(tenantA.prestataireId, randomUUID()),
  );
  assert(insert.error, "INSERT anonyme accepté");
});

await run("authenticated ne peut pas forger un INSERT", async () => {
  const forged = await tenantA.client
    .from(TABLE)
    .insert(buildAuditRow(tenantA.prestataireId, randomUUID()));
  assert(forged.error, "INSERT authenticated accepté");
});

await postgres.end();

const failed = results.filter((row) => !row.ok);
console.log("");
console.log(
  `G1-F RLS: ${results.length - failed.length}/${results.length} passés`,
);
if (failed.length > 0) {
  process.exitCode = 1;
}
