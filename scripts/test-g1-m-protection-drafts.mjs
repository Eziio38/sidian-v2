#!/usr/bin/env node
/**
 * G1-M — tests SQL / RLS / cross-tenant / idempotence pour agent_protection_drafts.
 * Fail-closed si migration absente ou Supabase local down.
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

const TABLE = "agent_protection_drafts";

const localConfig = assertLocalTestConfig();
const SUPABASE_URL = localConfig.url;

function localClient(key, options = {}) {
  return createClient(SUPABASE_URL, key, withLocalOnlyFetch(options));
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

function errorMessage(error) {
  return error instanceof Error
    ? error.message
    : error && typeof error === "object" && "message" in error
      ? String(error.message)
      : String(error);
}

async function ensureMigration() {
  const { rows } = await postgres.query(
    `select to_regclass('public.${TABLE}') as reg`,
  );
  if (!rows[0]?.reg) {
    console.error(
      `BLOCKED: table public.${TABLE} absente — appliquer migration 20260725220000_g1m_protection_drafts.sql`,
    );
    process.exit(1);
  }
}

async function createTenant(label) {
  const password = "G1M-Protection-Draft-Local-Password1!";
  const email = `g1m-${label}-${Date.now()}-${randomUUID()}@sidian.test`;
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
      nom: `Agence G1M ${label}`,
      email,
    })
    .select("id")
    .single();
  if (prestataire.error || !prestataire.data) {
    throw prestataire.error ?? new Error("prestataire_creation_failed");
  }
  return {
    authId: created.data.user.id,
    prestataireId: prestataire.data.id,
    email,
  };
}

function completeFields(nowIso) {
  return {
    client_name: {
      value: "Dupont Conseil",
      provenance: "agent_proposed",
      updated_at: nowIso,
    },
    client_email: {
      value: "jean@dupont.fr",
      provenance: "agent_proposed",
      updated_at: nowIso,
    },
    expected_amount_minor: {
      value: 240000,
      provenance: "agent_proposed",
      updated_at: nowIso,
    },
    currency: {
      value: "EUR",
      provenance: "agent_proposed",
      updated_at: nowIso,
    },
    due_date: {
      value: "2026-09-12",
      provenance: "agent_proposed",
      updated_at: nowIso,
    },
  };
}

async function run() {
  console.log("G1-M SQL — démarrage");
  await postgres.connect();
  await ensureMigration();

  const a = await createTenant("a");
  const b = await createTenant("b");
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 86400000).toISOString();
  const nonce = `nonce_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  // 1. upsert brouillon (pas de creance)
  {
    const { data, error } = await admin.rpc("upsert_agent_protection_draft", {
      p_tenant_id: a.prestataireId,
      p_actor_id: "actor_a",
      p_draft_id: null,
      p_conversation_id: null,
      p_state: "RECAPITULATIF",
      p_fields: completeFields(now),
      p_missing_fields: [],
      p_pending_question: null,
      p_open_ambiguities: [],
      p_attachments: [],
      p_client_creation_key: randomUUID(),
      p_creance_creation_key: randomUUID(),
      p_confirmation_nonce: nonce,
      p_expires_at: expires,
      p_now: now,
    });
    assert(!error, `upsert failed: ${errorMessage(error)}`);
    assert(data?.draft_id, "draft_id manquant");
    assert(data.state === "RECAPITULATIF", "state attendu RECAPITULATIF");
    assert(data.client_payeur_id == null, "pas de client avant confirm");
    assert(data.creance_id == null, "pas de creance avant confirm");
    results.push({ id: 1, name: "upsert_draft_no_business_write", ok: true });
    globalThis.__draftId = data.draft_id;
    globalThis.__clientKey = data.client_creation_key;
    globalThis.__creanceKey = data.creance_creation_key;
  }

  // 2. confirm atomique
  {
    const { data, error } = await admin.rpc("confirm_agent_protection_draft", {
      p_tenant_id: a.prestataireId,
      p_actor_id: "actor_a",
      p_draft_id: globalThis.__draftId,
      p_confirmation_nonce: nonce,
      p_now: now,
    });
    assert(!error, `confirm failed: ${errorMessage(error)}`);
    assert(data.outcome === "created", "outcome created");
    assert(data.client_payeur_id, "client créé");
    assert(data.creance_id, "creance créée");
    globalThis.__clientId = data.client_payeur_id;
    globalThis.__creanceId = data.creance_id;
    results.push({ id: 2, name: "confirm_atomic_create", ok: true });
  }

  // 3. replay idempotent
  {
    const { data, error } = await admin.rpc("confirm_agent_protection_draft", {
      p_tenant_id: a.prestataireId,
      p_actor_id: "actor_a",
      p_draft_id: globalThis.__draftId,
      p_confirmation_nonce: nonce,
      p_now: now,
    });
    assert(!error, `replay failed: ${errorMessage(error)}`);
    assert(data.outcome === "replay", "outcome replay");
    assert(data.client_payeur_id === globalThis.__clientId, "même client");
    assert(data.creance_id === globalThis.__creanceId, "même creance");
    results.push({ id: 3, name: "confirm_idempotent_replay", ok: true });
  }

  // 4. cross-tenant get refusé
  {
    const { error } = await admin.rpc("get_agent_protection_draft", {
      p_tenant_id: b.prestataireId,
      p_draft_id: globalThis.__draftId,
      p_now: now,
    });
    assert(error, "cross-tenant get doit échouer");
    results.push({ id: 4, name: "cross_tenant_get_denied", ok: true });
  }

  // 5. cross-tenant confirm refusé
  {
    const { error } = await admin.rpc("confirm_agent_protection_draft", {
      p_tenant_id: b.prestataireId,
      p_actor_id: "actor_b",
      p_draft_id: globalThis.__draftId,
      p_confirmation_nonce: nonce,
      p_now: now,
    });
    assert(error, "cross-tenant confirm doit échouer");
    results.push({ id: 5, name: "cross_tenant_confirm_denied", ok: true });
  }

  // 6. anon select vide / refusé
  {
    const { data, error } = await anon.from(TABLE).select("draft_id").limit(5);
    assert(!error || data?.length === 0 || data === null, "anon ne lit pas les drafts");
    assert((data ?? []).length === 0, "anon voit 0 lignes");
    results.push({ id: 6, name: "anon_select_empty", ok: true });
  }

  // 7. delete interdit
  {
    let blocked = false;
    try {
      await postgres.query(`delete from public.${TABLE} where draft_id = $1`, [
        globalThis.__draftId,
      ]);
    } catch {
      blocked = true;
    }
    assert(blocked, "DELETE doit être interdit");
    results.push({ id: 7, name: "delete_forbidden", ok: true });
  }

  // 8. cancel avant confirm
  {
    const nonce2 = `nonce_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const { data: created } = await admin.rpc("upsert_agent_protection_draft", {
      p_tenant_id: a.prestataireId,
      p_actor_id: "actor_a",
      p_draft_id: null,
      p_conversation_id: null,
      p_state: "RECAPITULATIF",
      p_fields: completeFields(now),
      p_missing_fields: [],
      p_pending_question: null,
      p_open_ambiguities: [],
      p_attachments: [{ attachment_id: "att1", filename: "x.pdf", content_type: "application/pdf", size_bytes: 10 }],
      p_client_creation_key: randomUUID(),
      p_creance_creation_key: randomUUID(),
      p_confirmation_nonce: nonce2,
      p_expires_at: expires,
      p_now: now,
    });
    const { data: cancelled, error } = await admin.rpc(
      "cancel_agent_protection_draft",
      {
        p_tenant_id: a.prestataireId,
        p_actor_id: "actor_a",
        p_draft_id: created.draft_id,
        p_now: now,
      },
    );
    assert(!error, `cancel failed: ${errorMessage(error)}`);
    assert(cancelled.state === "ANNULE", "state ANNULE");
    const { error: confirmErr } = await admin.rpc(
      "confirm_agent_protection_draft",
      {
        p_tenant_id: a.prestataireId,
        p_actor_id: "actor_a",
        p_draft_id: created.draft_id,
        p_confirmation_nonce: nonce2,
        p_now: now,
      },
    );
    assert(confirmErr, "confirm après cancel doit échouer");
    results.push({ id: 8, name: "cancel_then_confirm_denied", ok: true });
  }

  // 9. authenticated RPC denied (service_role only)
  {
    const { rows } = await postgres.query(
      `select has_function_privilege('authenticated', 'public.confirm_agent_protection_draft(uuid,text,uuid,text,timestamptz)', 'execute') as can_exec`,
    );
    assert(rows[0]?.can_exec === false, "authenticated ne doit pas exécuter confirm");
    results.push({ id: 9, name: "authenticated_rpc_denied", ok: true });
  }

  console.log(JSON.stringify({ suite: "g1-m-sql", results }, null, 2));
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error("FAIL", failed);
    process.exit(1);
  }
  console.log(`PASS ${results.length}/${results.length}`);
}

run()
  .catch((err) => {
    console.error("FAIL:", errorMessage(err));
    process.exit(1);
  })
  .finally(async () => {
    await postgres.end().catch(() => {});
  });
