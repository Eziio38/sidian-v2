#!/usr/bin/env node
/**
 * SID-PROD-002 P1 — archivage sûr et clôture des dossiers terminaux.
 *
 * Cible exclusivement Supabase local. Le service_role ne sert qu'à fabriquer
 * les états financiers que le navigateur ne peut pas écrire.
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
    results.push({ name, ok: true });
    console.log(`✓ ${name}`);
  } catch (error) {
    const message = errorMessage(error);
    results.push({ name, ok: false, message });
    console.error(`✗ ${name}: ${message}`);
  }
}

async function createTenant(label) {
  const email = `prod-002-p1-${label}-${randomUUID()}@sidian.test`;
  const password = "Prod002-P1-Local1!";
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error("auth_user_creation_failed");
  }

  const authClient = localClient(LOCAL_DEMO_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signedIn = await authClient.auth.signInWithPassword({ email, password });
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

async function createDraft(tenant, label) {
  const payeur = await tenant.client.rpc("create_current_client_payeur", {
    p_nom: `Client ${label}`,
    p_email: `p1-${randomUUID()}@example.com`,
    p_creation_key: randomUUID(),
  });
  if (payeur.error || !payeur.data) {
    throw payeur.error ?? new Error("client_payeur_creation_failed");
  }

  const creance = await tenant.client.rpc("create_current_creance", {
    p_client_payeur_id: payeur.data.id,
    p_montant: 12_000,
    p_date_echeance: "2099-12-15",
    p_creation_key: randomUUID(),
    p_libelle: label,
    p_reference_externe: null,
    p_devise: "EUR",
  });
  if (creance.error || !creance.data) {
    throw creance.error ?? new Error("payment_receivable_creation_failed");
  }
  return creance.data;
}

async function openReceivable(tenant, creanceId) {
  const opened = await tenant.client.rpc("open_payment_receivable", {
    p_creance_id: creanceId,
  });
  if (opened.error || !opened.data) {
    throw opened.error ?? new Error("payment_receivable_open_failed");
  }
  return opened.data;
}

async function setFinancialState(creanceId, state) {
  const updated = await admin
    .from("creance")
    .update({ etat: state })
    .eq("id", creanceId);
  if (updated.error) throw updated.error;
}

async function getCreance(creanceId) {
  const response = await admin
    .from("creance")
    .select("etat, archived_at, updated_at")
    .eq("id", creanceId)
    .single();
  if (response.error || !response.data) {
    throw response.error ?? new Error("creance_missing");
  }
  return response.data;
}

async function countFollowUpUpdates(creanceId) {
  const response = await admin
    .from("audit_log")
    .select("*", { count: "exact", head: true })
    .eq("entity_type", "creance")
    .eq("entity_id", creanceId)
    .eq("action", "FOLLOW_UP_CASE_UPDATED");
  if (response.error) throw response.error;
  return response.count ?? 0;
}

await postgres.connect();

const tenantA = await createTenant("A");
const tenantB = await createTenant("B");

await run("RPC durcies : SECURITY DEFINER, search_path et ACL minimale", async () => {
  const inspected = await postgres.query(
    `select
       p.proname,
       p.prosecdef,
       p.proconfig,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute
     from pg_catalog.pg_proc as p
     join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any($1::text[])
     order by p.proname`,
    [["archive_current_creance", "update_current_dossier_suivi"]],
  );

  assert(inspected.rowCount === 2, "RPC durcie manquante");
  for (const row of inspected.rows) {
    assert(row.prosecdef === true, `${row.proname}: SECURITY DEFINER absent`);
    assert(
      (row.proconfig ?? []).includes("search_path=pg_catalog, public, pg_temp"),
      `${row.proname}: search_path non explicite`,
    );
    assert(row.auth_execute === true, `${row.proname}: authenticated absent`);
    assert(row.anon_execute === false, `${row.proname}: anon autorisé`);
    assert(row.service_execute === false, `${row.proname}: service_role autorisé`);
  }
});

await run("archivage BROUILLON autorisé et idempotent", async () => {
  const creance = await createDraft(tenantA, "archive-brouillon");
  const first = await tenantA.client.rpc("archive_current_creance", {
    p_id: creance.id,
  });
  if (first.error || !first.data) throw first.error ?? new Error("archive_absente");
  assert(first.data.archived_at, "brouillon non archivé");

  const replay = await tenantA.client.rpc("archive_current_creance", {
    p_id: creance.id,
  });
  if (replay.error || !replay.data) throw replay.error ?? new Error("replay_absent");
  assert(replay.data.archived_at === first.data.archived_at, "replay a réécrit archived_at");
  assert(replay.data.updated_at === first.data.updated_at, "replay a réécrit updated_at");
});

await run("archivage refuse OUVERTE, PARTIELLEMENT_REGLEE et EN_LITIGE", async () => {
  for (const state of ["OUVERTE", "PARTIELLEMENT_REGLEE", "EN_LITIGE"]) {
    const creance = await createDraft(tenantA, `archive-refus-${state}`);
    await openReceivable(tenantA, creance.id);
    if (state !== "OUVERTE") await setFinancialState(creance.id, state);

    const archived = await tenantA.client.rpc("archive_current_creance", {
      p_id: creance.id,
    });
    assert(archived.error, `${state}: archivage actif accepté`);
    const persisted = await getCreance(creance.id);
    assert(persisted.etat === state, `${state}: état financier modifié`);
    assert(persisted.archived_at === null, `${state}: effet partiel d'archivage`);
  }
});

await run("OUVERTE doit passer par l'annulation métier avant archivage", async () => {
  const creance = await createDraft(tenantA, "archive-apres-annulation");
  await openReceivable(tenantA, creance.id);

  const premature = await tenantA.client.rpc("archive_current_creance", {
    p_id: creance.id,
  });
  assert(premature.error, "OUVERTE archivée sans annulation métier");

  const cancelled = await tenantA.client.rpc(
    "cancel_current_payment_receivable",
    { p_creance_id: creance.id },
  );
  if (cancelled.error || !cancelled.data) {
    throw cancelled.error ?? new Error("annulation_absente");
  }
  assert(cancelled.data.creance_state === "ANNULEE", "annulation non persistée");

  const archived = await tenantA.client.rpc("archive_current_creance", {
    p_id: creance.id,
  });
  if (archived.error || !archived.data) {
    throw archived.error ?? new Error("archive_apres_annulation_absente");
  }
  assert(archived.data.etat === "ANNULEE", "archivage a réécrit l'état");
  assert(archived.data.archived_at, "ANNULEE non archivée");
});

await run("archivage autorise uniquement les trois états financiers terminaux", async () => {
  for (const state of ["REGLEE", "ANNULEE", "IRRECOUVRABLE"]) {
    const creance = await createDraft(tenantA, `archive-terminal-${state}`);
    await openReceivable(tenantA, creance.id);
    await setFinancialState(creance.id, state);

    const archived = await tenantA.client.rpc("archive_current_creance", {
      p_id: creance.id,
    });
    if (archived.error || !archived.data) {
      throw archived.error ?? new Error(`${state}: archive absente`);
    }
    assert(archived.data.etat === state, `${state}: état réécrit`);
    assert(archived.data.archived_at, `${state}: archive absente`);
  }
});

await run("archivage reste tenant-isolé", async () => {
  const creance = await createDraft(tenantA, "archive-tenant");
  const foreign = await tenantB.client.rpc("archive_current_creance", {
    p_id: creance.id,
  });
  assert(foreign.error, "archivage cross-tenant accepté");
  assert((await getCreance(creance.id)).archived_at === null, "effet cross-tenant");
});

await run("créance terminale refuse toute progression relationnelle non CLOS", async () => {
  for (const state of ["REGLEE", "ANNULEE", "IRRECOUVRABLE"]) {
    const creance = await createDraft(tenantA, `dossier-refus-${state}`);
    await openReceivable(tenantA, creance.id);
    const dossier = await tenantA.client.rpc("ensure_current_dossier_suivi", {
      p_creance_id: creance.id,
    });
    if (dossier.error || !dossier.data) {
      throw dossier.error ?? new Error(`${state}: dossier absent`);
    }
    await setFinancialState(creance.id, state);

    const transition = await tenantA.client.rpc("update_current_dossier_suivi", {
      p_creance_id: creance.id,
      p_target_state: "ECHEANCE",
      p_next_action_at: "2099-12-20T10:00:00.000Z",
      p_escalation_reason: null,
    });
    assert(transition.error, `${state}: dossier terminal encore progressable`);

    const persisted = await admin
      .from("dossier_suivi")
      .select("etat, next_action_at, clos_at")
      .eq("id", dossier.data.id)
      .single();
    if (persisted.error || !persisted.data) {
      throw persisted.error ?? new Error("dossier_missing");
    }
    assert(persisted.data.etat === "PREVENTION", `${state}: effet partiel`);
    assert(persisted.data.next_action_at === null, `${state}: planification partielle`);
    assert(persisted.data.clos_at === null, `${state}: clôture inventée`);
  }
});

await run("créance terminale autorise CLOS puis son replay exact", async () => {
  const creance = await createDraft(tenantA, "dossier-cloture-terminale");
  await openReceivable(tenantA, creance.id);
  await tenantA.client.rpc("ensure_current_dossier_suivi", {
    p_creance_id: creance.id,
  });
  await setFinancialState(creance.id, "REGLEE");

  const first = await tenantA.client.rpc("update_current_dossier_suivi", {
    p_creance_id: creance.id,
    p_target_state: "CLOS",
    p_next_action_at: null,
    p_escalation_reason: null,
  });
  if (first.error || !first.data) throw first.error ?? new Error("cloture_absente");
  assert(first.data.etat === "CLOS" && first.data.clos_at, "clôture incomplète");
  assert(first.data.next_action_at === null, "action conservée après clôture");
  const auditCount = await countFollowUpUpdates(creance.id);

  const replay = await tenantA.client.rpc("update_current_dossier_suivi", {
    p_creance_id: creance.id,
    p_target_state: "CLOS",
    p_next_action_at: null,
    p_escalation_reason: null,
  });
  if (replay.error || !replay.data) throw replay.error ?? new Error("replay_absent");
  assert(replay.data.updated_at === first.data.updated_at, "replay CLOS a réécrit");
  assert(
    (await countFollowUpUpdates(creance.id)) === auditCount,
    "replay CLOS a dupliqué l'audit",
  );
});

await postgres.end();

const failed = results.filter((result) => !result.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} tests SID-PROD-002 P1 réussis`,
);
if (failed.length > 0) {
  for (const result of failed) {
    console.error(`- ${result.name}: ${result.message}`);
  }
  process.exitCode = 1;
}
