#!/usr/bin/env node
/**
 * SID-SEC — attestation d'environnement Supabase, local uniquement.
 */

import { createHmac } from "node:crypto";

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

const LOCAL_JWT_SECRET =
  "super-secret-jwt-token-with-at-least-32-characters-long";
const localConfig = assertLocalTestConfig();

function base64url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function signAttestationJwt({
  secret = LOCAL_JWT_SECRET,
  environment = "local",
  projectRef = "localdev123",
} = {}) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      role: "sidian_environment_attestor",
      aud: "sidian_environment_attestor",
      sidian_environment: environment,
      sidian_project_ref: projectRef,
      exp: Math.floor(Date.now() / 1000) + 3_600,
    }),
  );
  const signature = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function localClient(key, options = {}) {
  return createClient(localConfig.url, key, withLocalOnlyFetch(options));
}

function attestorClient(token = signAttestationJwt()) {
  return localClient(LOCAL_DEMO_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

const admin = localClient(LOCAL_DEMO_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = localClient(LOCAL_DEMO_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const postgres = createLocalPgClient(resolveLocalPostgresUrl(), pg);
await postgres.connect();

const results = [];

async function run(name, test) {
  try {
    await test();
    results.push({ name, ok: true });
    console.log(`✓ ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, ok: false, message });
    console.error(`✗ ${name}: ${message}`);
  }
}

await run("rôle attestor minimal et fonctions à ACL étroites", async () => {
  const { rows } = await postgres.query(`
    select
      r.rolcanlogin,
      r.rolinherit,
      r.rolbypassrls,
      has_function_privilege(
        'sidian_environment_attestor',
        'public.attest_sidian_environment()',
        'EXECUTE'
      ) as attestor_can_attest,
      has_function_privilege(
        'sidian_environment_attestor',
        'public.service_role_healthcheck()',
        'EXECUTE'
      ) as attestor_can_admin_probe,
      has_function_privilege(
        'service_role',
        'public.attest_sidian_environment()',
        'EXECUTE'
      ) as service_can_attest,
      has_function_privilege(
        'service_role',
        'public.service_role_healthcheck()',
        'EXECUTE'
      ) as service_can_admin_probe,
      has_table_privilege(
        'sidian_environment_attestor',
        'public.prestataire',
        'SELECT'
      ) as attestor_can_read_business
    from pg_catalog.pg_roles as r
    where r.rolname = 'sidian_environment_attestor'
  `);
  const role = rows[0];
  if (
    !role ||
    role.rolcanlogin ||
    role.rolinherit ||
    role.rolbypassrls ||
    !role.attestor_can_attest ||
    role.attestor_can_admin_probe ||
    role.service_can_attest ||
    !role.service_can_admin_probe ||
    role.attestor_can_read_business
  ) {
    throw new Error(`ACL attestor inattendue: ${JSON.stringify(role)}`);
  }
});

await run("JWT signé par le projet retourne uniquement environnement et ref", async () => {
  const { data, error } = await attestorClient().rpc(
    "attest_sidian_environment",
  );
  if (error) throw error;
  if (
    data?.environment !== "local" ||
    data?.project_ref !== "localdev123" ||
    Object.keys(data).length !== 2
  ) {
    throw new Error(`attestation inattendue: ${JSON.stringify(data)}`);
  }
});

await run("signature ou claims invalides et rôles ordinaires sont refusés", async () => {
  const wrongSignature = await attestorClient(
    signAttestationJwt({ secret: "wrong-secret-with-at-least-32-characters" }),
  ).rpc("attest_sidian_environment");
  if (!wrongSignature.error) throw new Error("signature invalide acceptée");

  const invalidClaims = await attestorClient(
    signAttestationJwt({ projectRef: "bad" }),
  ).rpc("attest_sidian_environment");
  if (!invalidClaims.error) throw new Error("claims invalides acceptés");

  const anonAttempt = await anon.rpc("attest_sidian_environment");
  if (!anonAttempt.error) throw new Error("anon peut attester");

  const serviceAttempt = await admin.rpc("attest_sidian_environment");
  if (!serviceAttempt.error) throw new Error("service_role peut attester");
});

await run("service_role prouve le projet sans exposer la RPC", async () => {
  const probe = await admin.rpc("service_role_healthcheck");
  if (probe.error || probe.data !== true) {
    throw probe.error ?? new Error("probe service_role invalide");
  }

  const anonProbe = await anon.rpc("service_role_healthcheck");
  if (!anonProbe.error) throw new Error("anon peut sonder la service_role");

  const attestorProbe = await attestorClient().rpc(
    "service_role_healthcheck",
  );
  if (!attestorProbe.error) throw new Error("attestor peut sonder la service_role");
});

await run("fonctions SECURITY DEFINER avec search_path explicite", async () => {
  const { rows } = await postgres.query(`
    select
      p.proname,
      p.prosecdef,
      p.proconfig
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'attest_sidian_environment',
        'service_role_healthcheck'
      )
    order by p.proname
  `);
  if (rows.length !== 2) throw new Error("fonctions d'attestation absentes");
  for (const row of rows) {
    if (
      row.prosecdef !== true ||
      !row.proconfig?.includes("search_path=pg_catalog, public, pg_temp")
    ) {
      throw new Error(`fonction non durcie: ${JSON.stringify(row)}`);
    }
  }
});

await postgres.end();

const failures = results.filter((result) => !result.ok);
console.log(
  `\nSID-SEC environnement: ${results.length - failures.length}/${results.length} tests réussis.`,
);
if (failures.length > 0) process.exitCode = 1;
