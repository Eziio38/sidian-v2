#!/usr/bin/env node
/**
 * G1-K — tests d’intégration auth / membership / RLS (Request Gateway).
 * Supabase local uniquement (JWT authenticated + service_role + pg).
 *
 * Couverture :
 * 31 session Supabase valide résolue
 * 32 session invalide refusée
 * 33 utilisateur tenant A ne peut construire un contexte tenant B
 * 34 utilisateur tenant A peut construire son contexte tenant A
 * 35 utilisateur sans membership refusé
 * 36 membership désactivée refusée
 * 37 actor désactivé refusé si modèle disponible
 * 38 requête anon refusée
 * 39 tenant vérifié propagé aux opérations RLS
 * 40 aucun accès cross-tenant via repository
 * 41 aucune élévation via service role
 * 42 aucune confiance dans un claim client non vérifié
 *
 * Fail-closed si auth locale absente :
 *   message clair + exit 1 (pas de faux PASS).
 *
 * Lancer (stack locale up, migrations appliquées) :
 *   node scripts/test-g1-k-agent-gateway-auth.mjs
 *   # ou : node scripts/test-local-supabase-guard.mjs && node scripts/test-g1-k-agent-gateway-auth.mjs
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

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
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const INTEGRATION_TEST =
  "src/lib/agent/gateway/gateway.auth.integration.test.ts";
const ADAPTERS_INDEX = path.join(
  ROOT,
  "src/lib/agent/gateway/adapters/index.ts",
);
const GATEWAY_INDEX = path.join(ROOT, "src/lib/agent/gateway/index.ts");

const localConfig = assertLocalTestConfig();
const SUPABASE_URL = localConfig.url;

function localClient(key, options = {}) {
  return createClient(SUPABASE_URL, key, withLocalOnlyFetch(options));
}

function errorMessage(error) {
  return error instanceof Error
    ? error.message
    : error && typeof error === "object" && "message" in error
      ? String(error.message)
      : String(error);
}

/**
 * Fail-closed : auth locale absente / injoignable → exit 1, jamais PASS silencieux.
 */
async function assertLocalAuthReachable() {
  if (!existsSync(GATEWAY_INDEX)) {
    throw new Error(
      "Fail-closed G1-K : module gateway absent (src/lib/agent/gateway/index.ts).",
    );
  }
  if (!existsSync(ADAPTERS_INDEX)) {
    throw new Error(
      "Fail-closed G1-K : adapters auth absents (src/lib/agent/gateway/adapters/).",
    );
  }
  if (!existsSync(path.join(ROOT, INTEGRATION_TEST))) {
    throw new Error(
      `Fail-closed G1-K : fichier d’intégration absent (${INTEGRATION_TEST}).`,
    );
  }

  const healthUrl = `${SUPABASE_URL}/auth/v1/health`;
  let response;
  try {
    response = await fetch(healthUrl, {
      method: "GET",
      headers: { apikey: LOCAL_DEMO_ANON_KEY },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    throw new Error(
      `Fail-closed G1-K : auth locale absente ou injoignable (${healthUrl}) — ${errorMessage(error)}. ` +
        "Démarrer Supabase local (`pnpm supabase:start`) puis relancer.",
    );
  }

  if (!response.ok) {
    throw new Error(
      `Fail-closed G1-K : auth locale répond HTTP ${response.status} sur ${healthUrl}. ` +
        "Vérifier `supabase status` / migrations.",
    );
  }

  // Probe Auth Admin (service_role) — requis pour créer fixtures.
  const admin = localClient(LOCAL_DEMO_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const probe = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (probe.error) {
    throw new Error(
      `Fail-closed G1-K : Auth Admin local indisponible — ${probe.error.message}`,
    );
  }

  // Probe Postgres + table prestataire (membership).
  const postgres = createLocalPgClient(resolveLocalPostgresUrl(), pg);
  try {
    await postgres.connect();
    const table = await postgres.query(
      `select 1 from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'prestataire'`,
    );
    if (table.rowCount !== 1) {
      throw new Error(
        "Fail-closed G1-K : table public.prestataire absente (migrations non appliquées).",
      );
    }
  } finally {
    await postgres.end().catch(() => undefined);
  }
}

console.log("G1-K — contrôle fail-closed auth locale…");

try {
  await assertLocalAuthReachable();
  console.log("✓ auth locale joignable + gateway/adapters présents");
} catch (error) {
  console.error(`✗ ${errorMessage(error)}`);
  process.exit(1);
}

console.log("");
console.log(`G1-K — exécution ${INTEGRATION_TEST} (vitest)…`);
console.log("");

const result = spawnSync(
  "pnpm",
  ["exec", "vitest", "run", INTEGRATION_TEST],
  {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      SIDIAN_TEST_SUPABASE_URL: SUPABASE_URL,
      SIDIAN_G1K_REQUIRE_AUTH: "1",
    },
  },
);

if (result.error) {
  console.error(
    `Fail-closed G1-K : impossible de lancer vitest — ${errorMessage(result.error)}`,
  );
  process.exit(1);
}

const code = result.status ?? 1;
if (code !== 0) {
  console.error("");
  console.error(
    `G1-K auth/RLS: échec (exit ${code}) — pas de faux PASS.`,
  );
}
process.exit(code);
