#!/usr/bin/env node
/** SID-PROD-003 — profil et première étape d'onboarding, Supabase local. */

import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import pg from "pg";

import {
  assertLocalTestConfig,
  LOCAL_DEMO_ANON_KEY,
  LOCAL_DEMO_SERVICE_ROLE_KEY,
} from "./lib/assert-local-supabase.mjs";
import { withLocalOnlyFetch } from "./lib/local-only-fetch.mjs";
import {
  createLocalPgClient,
  resolveLocalPostgresUrl,
} from "./lib/assert-local-postgres.mjs";

const localConfig = assertLocalTestConfig();

function localClient(key, options = {}) {
  return createClient(localConfig.url, key, withLocalOnlyFetch(options));
}

const admin = localClient(LOCAL_DEMO_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = localClient(LOCAL_DEMO_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const postgres = createLocalPgClient(resolveLocalPostgresUrl(), pg);

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
  const password = "ProfileOnboarding123!";
  const email = `profile-${label}-${Date.now()}-${randomUUID()}@sidian.test`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error("auth_user_creation_failed");
  }

  const auth = localClient(LOCAL_DEMO_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signedIn = await auth.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session) {
    throw signedIn.error ?? new Error("auth_sign_in_failed");
  }
  const client = localClient(LOCAL_DEMO_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${signedIn.data.session.access_token}`,
      },
    },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const ensured = await client.rpc("ensure_prestataire_for_current_user", {
    p_nom: `Agence ${label}`,
  });
  if (ensured.error || !ensured.data) {
    throw ensured.error ?? new Error("prestataire_creation_failed");
  }
  return { client, prestataire: ensured.data };
}

let tenantA;
let tenantB;
let firstConfiguredAt;

await postgres.connect();

await run("RPC profil SECURITY DEFINER à ACL et search_path étroits", async () => {
  const result = await postgres.query(
    `select
       p.prosecdef,
       p.proconfig,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute
     from pg_catalog.pg_proc as p
     join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'configure_current_prestataire_profile'`,
  );
  assert(result.rowCount === 1, "RPC profil absente");
  const row = result.rows[0];
  assert(row.prosecdef === true, "SECURITY DEFINER absent");
  assert(
    (row.proconfig ?? []).includes("search_path=pg_catalog, public, pg_temp"),
    "search_path non explicite",
  );
  assert(row.auth_execute === true, "authenticated sans EXECUTE");
  assert(row.anon_execute === false, "anon peut exécuter la RPC");
  assert(row.service_execute === false, "service_role peut exécuter la RPC");
});

await run("RPC profil refuse une session anonyme", async () => {
  const response = await anon.rpc("configure_current_prestataire_profile", {
    p_nom: "Agence anonyme",
    p_profil_agent: "controle",
  });
  assert(Boolean(response.error), "la RPC anonyme a été acceptée");
});

await run("configuration profil tenant-safe et auditée", async () => {
  tenantA = await createTenant("A");
  tenantB = await createTenant("B");

  const response = await tenantA.client.rpc(
    "configure_current_prestataire_profile",
    { p_nom: "  Atelier   Horizon  ", p_profil_agent: "delegation" },
  );
  if (response.error || !response.data) {
    throw response.error ?? new Error("profile_configuration_failed");
  }
  assert(response.data.nom === "Atelier Horizon", "nom non canonisé");
  assert(response.data.profil_agent_defaut === "delegation", "profil incorrect");
  assert(Boolean(response.data.onboarding_profile_completed_at), "progression absente");
  firstConfiguredAt = response.data.onboarding_profile_completed_at;

  const audits = await admin
    .from("audit_log")
    .select("id, metadata")
    .eq("prestataire_id", tenantA.prestataire.id)
    .eq("action", "prestataire.profile_configured");
  if (audits.error) throw audits.error;
  assert(audits.data.length === 1, `audit count=${audits.data.length}`);
  assert(
    JSON.stringify(audits.data[0].metadata).includes("delegation"),
    "profil absent de l'audit",
  );
  assert(
    !JSON.stringify(audits.data[0].metadata).includes("Atelier Horizon"),
    "nom personnel inutile présent dans l'audit",
  );
});

await run("replay identique idempotent", async () => {
  const replay = await tenantA.client.rpc(
    "configure_current_prestataire_profile",
    { p_nom: "Atelier Horizon", p_profil_agent: "delegation" },
  );
  if (replay.error || !replay.data) throw replay.error;
  assert(
    replay.data.onboarding_profile_completed_at === firstConfiguredAt,
    "timestamp de première configuration modifié",
  );
  const audits = await admin
    .from("audit_log")
    .select("id", { count: "exact" })
    .eq("prestataire_id", tenantA.prestataire.id)
    .eq("action", "prestataire.profile_configured");
  if (audits.error) throw audits.error;
  assert(audits.count === 1, `audit rejoué ${audits.count} fois`);
});

await run("aucun identifiant tenant n'est accepté par la commande", async () => {
  const configured = await tenantB.client.rpc(
    "configure_current_prestataire_profile",
    { p_nom: "Agence B confirmée", p_profil_agent: "controle" },
  );
  if (configured.error || !configured.data) throw configured.error;
  assert(configured.data.id === tenantB.prestataire.id, "mauvais tenant modifié");

  const unchanged = await admin
    .from("prestataire")
    .select("nom")
    .eq("id", tenantA.prestataire.id)
    .single();
  if (unchanged.error) throw unchanged.error;
  assert(unchanged.data.nom === "Atelier Horizon", "tenant A altéré par B");
});

await run("UPDATE direct du profil reste refusé", async () => {
  const response = await tenantA.client
    .from("prestataire")
    .update({ profil_agent_defaut: "controle" })
    .eq("id", tenantA.prestataire.id);
  assert(Boolean(response.error), "UPDATE direct autorisé");
});

await run("noms invalides rejetés sans mutation", async () => {
  for (const p_nom of [" ", "A", "x".repeat(201)]) {
    const response = await tenantA.client.rpc(
      "configure_current_prestataire_profile",
      { p_nom, p_profil_agent: "controle" },
    );
    assert(Boolean(response.error), `nom invalide accepté (${p_nom.length})`);
  }
  const row = await admin
    .from("prestataire")
    .select("nom, profil_agent_defaut")
    .eq("id", tenantA.prestataire.id)
    .single();
  if (row.error) throw row.error;
  assert(row.data.nom === "Atelier Horizon", "nom modifié après erreur");
  assert(row.data.profil_agent_defaut === "delegation", "profil modifié après erreur");
});

const failed = results.filter((result) => !result.ok);
console.log(`\nSID-PROD-003: ${results.length - failed.length}/${results.length} tests réussis.`);
await postgres.end();
if (failed.length > 0) process.exitCode = 1;
