#!/usr/bin/env node
/**
 * G1-L — tests d’intégration Server Entry Point (auth / tenant / RLS).
 * Supabase local uniquement (JWT authenticated + service_role + pg).
 *
 * Couverture :
 * 46 utilisateur tenant A → tenant A accepté
 * 47 utilisateur tenant A → tenant B refusé
 * 48 utilisateur sans membership refusé
 * 49 membership désactivée refusée
 * 50 requête anonyme refusée
 * 51 session réellement vérifiée
 * 52 RPC sensible impossible avec un tenant arbitraire
 * 53 service role ne permet pas de contourner le handler
 * 54 audit stocke le tenant vérifié
 * 55 idempotence utilise le tenant vérifié
 * 56 approval utilise le tenant vérifié
 *
 * Fail-closed si auth locale absente :
 *   message clair + exit 1 (pas de faux PASS).
 *
 * Lancer (stack locale up, migrations appliquées) :
 *   node scripts/test-g1-l-agent-server-auth.mjs
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
  "src/lib/agent/server/server.auth.integration.test.ts";
const SERVER_INDEX = path.join(ROOT, "src/lib/agent/server/index.ts");
const HANDLER_TEST = path.join(
  ROOT,
  "src/lib/agent/server/route-handler.test.ts",
);

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
  if (!existsSync(SERVER_INDEX)) {
    throw new Error(
      "Fail-closed G1-L : module server absent (src/lib/agent/server/index.ts).",
    );
  }
  if (!existsSync(HANDLER_TEST)) {
    throw new Error(
      "Fail-closed G1-L : tests unitaires absents (route-handler.test.ts).",
    );
  }
  if (!existsSync(path.join(ROOT, INTEGRATION_TEST))) {
    throw new Error(
      `Fail-closed G1-L : fichier d’intégration absent (${INTEGRATION_TEST}).`,
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
      `Fail-closed G1-L : auth locale absente ou injoignable (${healthUrl}) — ${errorMessage(error)}. ` +
        "Démarrer Supabase local (`pnpm supabase:start`) puis relancer.",
    );
  }

  if (!response.ok) {
    throw new Error(
      `Fail-closed G1-L : auth locale répond HTTP ${response.status} sur ${healthUrl}. ` +
        "Vérifier `supabase status` / migrations.",
    );
  }

  const admin = localClient(LOCAL_DEMO_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const probe = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (probe.error) {
    throw new Error(
      `Fail-closed G1-L : Auth Admin local indisponible — ${probe.error.message}`,
    );
  }

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
        "Fail-closed G1-L : table public.prestataire absente (migrations non appliquées).",
      );
    }
  } finally {
    await postgres.end().catch(() => undefined);
  }
}

console.log("G1-L — contrôle fail-closed auth locale…");

try {
  await assertLocalAuthReachable();
  console.log("✓ auth locale joignable + server handler présents");
} catch (error) {
  console.error(`✗ ${errorMessage(error)}`);
  process.exit(1);
}

console.log("");
console.log(`G1-L — exécution ${INTEGRATION_TEST} (vitest)…`);
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
      SIDIAN_G1L_REQUIRE_AUTH: "1",
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: LOCAL_DEMO_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: LOCAL_DEMO_SERVICE_ROLE_KEY,
      SIDIAN_ENVIRONMENT: "local",
    },
  },
);

if (result.error) {
  console.error(
    `Fail-closed G1-L : impossible de lancer vitest — ${errorMessage(result.error)}`,
  );
  process.exit(1);
}

const code = result.status ?? 1;
if (code !== 0) {
  console.error("");
  console.error(
    `G1-L auth/entry: échec (exit ${code}) — pas de faux PASS.`,
  );
}
process.exit(code);
