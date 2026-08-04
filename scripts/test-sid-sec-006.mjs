#!/usr/bin/env node
/**
 * SID-SEC-006 — quotas persistants Auth, callback et webhook Stripe.
 * Supabase local uniquement ; le garde-fou refuse toute cible distante.
 */

import { createHmac, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import pg from "pg";

import {
  assertLocalTestConfig,
  LOCAL_DEMO_SERVICE_ROLE_KEY,
} from "./lib/assert-local-supabase.mjs";
import {
  createLocalPgClient,
  resolveLocalPostgresUrl,
} from "./lib/assert-local-postgres.mjs";
import { withLocalOnlyFetch } from "./lib/local-only-fetch.mjs";

const localConfig = assertLocalTestConfig();
const admin = createClient(
  localConfig.url,
  LOCAL_DEMO_SERVICE_ROLE_KEY,
  withLocalOnlyFetch({
    auth: { autoRefreshToken: false, persistSession: false },
  }),
);
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

function subjectHash(namespace, rawValue) {
  return createHmac("sha256", `sid-sec-006-${namespace}`)
    .update(rawValue)
    .digest("hex");
}

await run("les catégories SID-SEC-006 sont installées", async () => {
  const { rows } = await postgres.query(
    `select enumlabel
     from pg_catalog.pg_enum
     where enumtypid = 'public.public_rate_limit_category'::regtype`,
  );
  const labels = new Set(rows.map((row) => row.enumlabel));
  for (const category of [
    "auth_signup_ip",
    "auth_signup_email",
    "auth_signin_ip",
    "auth_signin_email",
    "auth_password_reset_ip",
    "auth_password_reset_email",
    "auth_password_update_ip",
    "auth_password_update_user",
    "auth_callback_ip",
    "auth_callback_code",
    "stripe_webhook_ip",
  ]) {
    if (!labels.has(category)) throw new Error(`catégorie absente: ${category}`);
  }
});

await run("le quota email de récupération est atomique à trois appels", async () => {
  const hash = subjectHash("password-reset", randomUUID());
  const calls = await Promise.all(
    Array.from({ length: 4 }, () =>
      admin.rpc("consume_public_rate_limit", {
        p_category: "auth_password_reset_email",
        p_subject_hash: hash,
      }),
    ),
  );
  if (calls.some((call) => call.error || !call.data)) {
    throw calls.find((call) => call.error)?.error ?? new Error("RPC absente");
  }
  if (
    calls.filter((call) => call.data.allowed).length !== 3 ||
    calls.filter((call) => !call.data.allowed).length !== 1
  ) {
    throw new Error("quota non atomique ou seuil incorrect");
  }
});

await run("le webhook conserve une fenêtre courte et une marge de rafale", async () => {
  const before = Date.now();
  const { data, error } = await admin.rpc("consume_public_rate_limit", {
    p_category: "stripe_webhook_ip",
    p_subject_hash: subjectHash("webhook", randomUUID()),
  });
  if (error || !data) throw error ?? new Error("décision absente");
  const resetAt = Date.parse(data.reset_at);
  if (!data.allowed || data.remaining !== 299) {
    throw new Error("seuil webhook incorrect");
  }
  if (resetAt < before + 55_000 || resetAt > Date.now() + 65_000) {
    throw new Error("fenêtre webhook différente d'une minute");
  }
});

await run("aucun sujet brut n'est accepté ni persisté", async () => {
  const rawEmail = `person-${randomUUID()}@example.com`;
  const invalid = await admin.rpc("consume_public_rate_limit", {
    p_category: "auth_signin_email",
    p_subject_hash: rawEmail,
  });
  if (!invalid.error) throw new Error("sujet brut accepté");

  const { rows } = await postgres.query(
    `select count(*)::integer as count
     from public.public_rate_limit_event
     where subject_hash = $1`,
    [rawEmail],
  );
  if (rows[0].count !== 0) throw new Error("sujet brut persisté");
});

await postgres.end();

const failures = results.filter((result) => !result.ok);
console.log(
  `\nSID-SEC-006: ${results.length - failures.length}/${results.length} tests réussis.`,
);
if (failures.length > 0) process.exitCode = 1;
