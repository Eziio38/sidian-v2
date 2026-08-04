#!/usr/bin/env node
/**
 * SID-PROD-002 — workflows cœur (dossier de suivi + annulation sûre).
 *
 * Cible exclusivement Supabase local. Les écritures service_role ci-dessous
 * servent uniquement à construire des états Stripe/financiers impossibles à
 * forger avec un JWT authenticated, puis les commandes publiques sont testées
 * avec de vrais utilisateurs et leurs RLS.
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
const anon = localClient(LOCAL_DEMO_ANON_KEY, {
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
  const email = `prod-002-${label}-${randomUUID()}@sidian.test`;
  const password = "Prod002-Local-Password1!";
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

  return {
    client,
    prestataire: ensured.data,
    userId: created.data.user.id,
  };
}

async function createDraft(
  tenant,
  label,
  { amount = 12_000, dueDate = "2099-12-15" } = {},
) {
  const payeur = await tenant.client.rpc("create_current_client_payeur", {
    p_nom: `Client ${label}`,
    p_email: `${label}-${randomUUID()}@example.com`,
    p_creation_key: randomUUID(),
  });
  if (payeur.error || !payeur.data) {
    throw payeur.error ?? new Error("client_payeur_creation_failed");
  }

  const creance = await tenant.client.rpc("create_current_creance", {
    p_client_payeur_id: payeur.data.id,
    p_montant: amount,
    p_date_echeance: dueDate,
    p_creation_key: randomUUID(),
    p_libelle: label,
    p_reference_externe: null,
    p_devise: "EUR",
  });
  if (creance.error || !creance.data) {
    throw creance.error ?? new Error("payment_receivable_creation_failed");
  }

  return { clientPayeur: payeur.data, creance: creance.data };
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

async function selectOne(table, columns, id) {
  const result = await admin.from(table).select(columns).eq("id", id).single();
  if (result.error || !result.data) {
    throw result.error ?? new Error(`${table}_row_missing`);
  }
  return result.data;
}

async function countAudits(creanceId, action) {
  const response = await admin
    .from("audit_log")
    .select("*", { count: "exact", head: true })
    .eq("entity_type", "creance")
    .eq("entity_id", creanceId)
    .eq("action", action);
  if (response.error) throw response.error;
  return response.count ?? 0;
}

await postgres.connect();

const tenantA = await createTenant("A");
const tenantB = await createTenant("B");

await run("RPC SECURITY DEFINER : search_path explicite et ACL minimale", async () => {
  const names = [
    "ensure_current_dossier_suivi",
    "update_current_dossier_suivi",
    "cancel_current_payment_receivable",
  ];
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
    [names],
  );

  assert(inspected.rowCount === names.length, "RPC SID-PROD-002 manquante");
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

  const helper = await postgres.query(
    `select
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute
     from pg_catalog.pg_proc as p
     join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'is_dossier_suivi_transition_allowed'`,
  );
  assert(helper.rowCount === 1, "helper de transition absent");
  assert(
    helper.rows[0].auth_execute === false &&
      helper.rows[0].anon_execute === false &&
      helper.rows[0].service_execute === false,
    "helper interne exposé",
  );
});

await run("aucun DML financier/probatoire direct n'est rendu au navigateur", async () => {
  for (const table of ["creance", "paiement", "dossier_suivi", "audit_log"]) {
    const relation = `public.${table}`;
    const privileges = await postgres.query(
      `select
         has_table_privilege('authenticated', $1, 'INSERT') as can_insert,
         has_table_privilege('authenticated', $1, 'UPDATE') as can_update,
         has_table_privilege('authenticated', $1, 'DELETE') as can_delete`,
      [relation],
    );
    const row = privileges.rows[0];
    assert(
      row.can_insert === false && row.can_update === false && row.can_delete === false,
      `${table}: DML authenticated résiduel`,
    );
  }

  const directDossier = await tenantA.client.from("dossier_suivi").insert({
    creance_id: randomUUID(),
    etat: "CLOS",
  });
  assert(directDossier.error, "INSERT direct dossier_suivi accepté");

  const directPayment = await tenantA.client.from("paiement").insert({
    creance_id: randomUUID(),
    montant: 1,
    source: "detecte_hors_sidian",
  });
  assert(directPayment.error, "INSERT direct paiement accepté");
});

await run("dossier créé en PREVENTION, idempotent, audité et tenant-isolé", async () => {
  const { creance } = await createDraft(tenantA, "dossier-prevention");
  await openReceivable(tenantA, creance.id);

  const first = await tenantA.client.rpc("ensure_current_dossier_suivi", {
    p_creance_id: creance.id,
  });
  if (first.error || !first.data) throw first.error ?? new Error("dossier absent");
  assert(first.data.etat === "PREVENTION", "état initial non préventif");
  assert(first.data.clos_at === null, "dossier actif déjà clos");

  const second = await tenantA.client.rpc("ensure_current_dossier_suivi", {
    p_creance_id: creance.id,
  });
  if (second.error || !second.data) throw second.error ?? new Error("replay absent");
  assert(second.data.id === first.data.id, "dossier dupliqué au replay");
  assert(
    (await countAudits(creance.id, "FOLLOW_UP_CASE_CREATED")) === 1,
    "audit de création dupliqué ou absent",
  );

  const own = await tenantA.client
    .from("dossier_suivi")
    .select("id")
    .eq("id", first.data.id);
  const foreign = await tenantB.client
    .from("dossier_suivi")
    .select("id")
    .eq("id", first.data.id);
  if (own.error || foreign.error) throw own.error ?? foreign.error;
  assert(own.data?.length === 1, "dossier propre masqué par RLS");
  assert(foreign.data?.length === 0, "dossier cross-tenant lisible");

  const foreignEnsure = await tenantB.client.rpc("ensure_current_dossier_suivi", {
    p_creance_id: creance.id,
  });
  assert(foreignEnsure.error, "ensure cross-tenant accepté");
});

await run("dossier dû créé en ECHEANCE et litige créé en PAUSE_LITIGE", async () => {
  const due = await createDraft(tenantA, "dossier-echeance", {
    dueDate: "2020-01-15",
  });
  await openReceivable(tenantA, due.creance.id);
  const dueCase = await tenantA.client.rpc("ensure_current_dossier_suivi", {
    p_creance_id: due.creance.id,
  });
  if (dueCase.error || !dueCase.data) throw dueCase.error ?? new Error("dossier dû absent");
  assert(dueCase.data.etat === "ECHEANCE", "échéance non matérialisée");

  const disputed = await createDraft(tenantA, "dossier-litige");
  await openReceivable(tenantA, disputed.creance.id);
  const disputeUpdate = await admin
    .from("creance")
    .update({ etat: "EN_LITIGE" })
    .eq("id", disputed.creance.id);
  if (disputeUpdate.error) throw disputeUpdate.error;
  const disputeCase = await tenantA.client.rpc("ensure_current_dossier_suivi", {
    p_creance_id: disputed.creance.id,
  });
  if (disputeCase.error || !disputeCase.data) {
    throw disputeCase.error ?? new Error("dossier litige absent");
  }
  assert(disputeCase.data.etat === "PAUSE_LITIGE", "litige non mis en pause");
});

await run("mise à jour dossier bornée, auditée et rejouable", async () => {
  const { creance } = await createDraft(tenantA, "dossier-update");
  await openReceivable(tenantA, creance.id);
  const ensured = await tenantA.client.rpc("ensure_current_dossier_suivi", {
    p_creance_id: creance.id,
  });
  if (ensured.error || !ensured.data) throw ensured.error ?? new Error("dossier absent");

  const nextAction = "2099-11-20T10:00:00.000Z";
  const first = await tenantA.client.rpc("update_current_dossier_suivi", {
    p_creance_id: creance.id,
    p_target_state: "PREVENTION",
    p_next_action_at: nextAction,
    p_escalation_reason: null,
  });
  if (first.error || !first.data) throw first.error ?? new Error("update absent");
  assert(
    new Date(first.data.next_action_at).getTime() === new Date(nextAction).getTime(),
    "planification non persistée",
  );

  const replay = await tenantA.client.rpc("update_current_dossier_suivi", {
    p_creance_id: creance.id,
    p_target_state: "PREVENTION",
    p_next_action_at: nextAction,
    p_escalation_reason: null,
  });
  if (replay.error || !replay.data) throw replay.error ?? new Error("replay absent");
  assert(replay.data.updated_at === first.data.updated_at, "replay a réécrit le dossier");
  assert(
    (await countAudits(creance.id, "FOLLOW_UP_CASE_UPDATED")) === 1,
    "audit d'update dupliqué",
  );

  const forward = await tenantA.client.rpc("update_current_dossier_suivi", {
    p_creance_id: creance.id,
    p_target_state: "ECHEANCE",
    p_next_action_at: nextAction,
    p_escalation_reason: null,
  });
  if (forward.error || !forward.data) throw forward.error ?? new Error("transition absente");
  assert(forward.data.etat === "ECHEANCE", "transition avant non appliquée");

  const backward = await tenantA.client.rpc("update_current_dossier_suivi", {
    p_creance_id: creance.id,
    p_target_state: "PREVENTION",
    p_next_action_at: null,
    p_escalation_reason: null,
  });
  assert(backward.error, "régression ECHEANCE -> PREVENTION acceptée");
  const persisted = await selectOne("dossier_suivi", "etat", ensured.data.id);
  assert(persisted.etat === "ECHEANCE", "transition invalide partiellement écrite");
});

await run("pause/escalade exige une raison et CLOS reste terminal", async () => {
  const { creance } = await createDraft(tenantA, "dossier-terminal");
  await openReceivable(tenantA, creance.id);

  const missingReason = await tenantA.client.rpc("update_current_dossier_suivi", {
    p_creance_id: creance.id,
    p_target_state: "PAUSE_LITIGE",
    p_next_action_at: null,
    p_escalation_reason: null,
  });
  assert(missingReason.error, "pause sans raison acceptée");

  const paused = await tenantA.client.rpc("update_current_dossier_suivi", {
    p_creance_id: creance.id,
    p_target_state: "PAUSE_LITIGE",
    p_next_action_at: null,
    p_escalation_reason: "Contesté par le client",
  });
  if (paused.error || !paused.data) throw paused.error ?? new Error("pause absente");

  const escalated = await tenantA.client.rpc("update_current_dossier_suivi", {
    p_creance_id: creance.id,
    p_target_state: "ESCALADE_HUMAINE",
    p_next_action_at: null,
    p_escalation_reason: "Décision humaine requise",
  });
  if (escalated.error || !escalated.data) {
    throw escalated.error ?? new Error("escalade absente");
  }

  const closed = await tenantA.client.rpc("update_current_dossier_suivi", {
    p_creance_id: creance.id,
    p_target_state: "CLOS",
    p_next_action_at: null,
    p_escalation_reason: null,
  });
  if (closed.error || !closed.data) throw closed.error ?? new Error("clôture absente");
  assert(closed.data.etat === "CLOS" && closed.data.clos_at, "clôture incomplète");

  const reopen = await tenantA.client.rpc("update_current_dossier_suivi", {
    p_creance_id: creance.id,
    p_target_state: "SUIVI_AMIABLE",
    p_next_action_at: null,
    p_escalation_reason: null,
  });
  assert(reopen.error, "dossier CLOS réouvert");
});

await run("annulation atomique révoque le lien, clôt le dossier et audite", async () => {
  const { creance } = await createDraft(tenantA, "annulation-complete");
  const opened = await openReceivable(tenantA, creance.id);
  const ensured = await tenantA.client.rpc("ensure_current_dossier_suivi", {
    p_creance_id: creance.id,
  });
  if (ensured.error || !ensured.data) throw ensured.error ?? new Error("dossier absent");

  const scheduled = await tenantA.client.rpc("update_current_dossier_suivi", {
    p_creance_id: creance.id,
    p_target_state: "PREVENTION",
    p_next_action_at: "2099-11-20T10:00:00.000Z",
    p_escalation_reason: null,
  });
  if (scheduled.error) throw scheduled.error;

  const cancelled = await tenantA.client.rpc("cancel_current_payment_receivable", {
    p_creance_id: creance.id,
  });
  if (cancelled.error || !cancelled.data) {
    throw cancelled.error ?? new Error("annulation absente");
  }
  assert(cancelled.data.changed === true, "annulation non signalée");
  assert(cancelled.data.creance_state === "ANNULEE", "état financier incorrect");
  assert(cancelled.data.confirmed_amount === 0, "montant confirmé inventé");
  assert(cancelled.data.revoked_payment_link_count === 1, "lien non révoqué");
  assert(cancelled.data.dossier_state === "CLOS", "dossier non clos");
  assert(cancelled.data.dossier_changed === true, "clôture dossier non signalée");

  const persistedCreance = await selectOne("creance", "etat", creance.id);
  const persistedLink = await selectOne(
    "payment_link",
    "status, revoked_at, token_hash",
    opened.payment_link_id,
  );
  const persistedDossier = await selectOne(
    "dossier_suivi",
    "etat, next_action_at, clos_at",
    ensured.data.id,
  );
  assert(persistedCreance.etat === "ANNULEE", "créance non annulée");
  assert(
    persistedLink.status === "revoked" && persistedLink.revoked_at,
    "capacité publique encore active",
  );
  assert(
    persistedDossier.etat === "CLOS" &&
      persistedDossier.next_action_at === null &&
      persistedDossier.clos_at,
    "dossier de suivi incohérent",
  );
  assert(
    (await countAudits(creance.id, "PAYMENT_RECEIVABLE_CANCELLED")) === 1,
    "audit d'annulation absent",
  );
  assert(
    (await countAudits(creance.id, "FOLLOW_UP_CASE_CLOSED")) === 1,
    "audit de clôture absent",
  );

  const audits = await admin
    .from("audit_log")
    .select("metadata")
    .eq("entity_id", creance.id)
    .in("action", ["PAYMENT_RECEIVABLE_CANCELLED", "FOLLOW_UP_CASE_CLOSED"]);
  if (audits.error) throw audits.error;
  assert(
    !JSON.stringify(audits.data).includes(persistedLink.token_hash),
    "empreinte de lien inutilement copiée dans l'audit",
  );
});

await run("replay et concurrence d'annulation sont idempotents", async () => {
  const { creance } = await createDraft(tenantA, "annulation-concurrente");
  await openReceivable(tenantA, creance.id);

  const [left, right] = await Promise.all([
    tenantA.client.rpc("cancel_current_payment_receivable", {
      p_creance_id: creance.id,
    }),
    tenantA.client.rpc("cancel_current_payment_receivable", {
      p_creance_id: creance.id,
    }),
  ]);
  if (left.error || right.error || !left.data || !right.data) {
    throw left.error ?? right.error ?? new Error("résultat concurrent absent");
  }
  const changed = [left.data.changed, right.data.changed].sort();
  assert(
    changed[0] === false && changed[1] === true,
    `résultats concurrents incohérents: ${JSON.stringify(changed)}`,
  );
  assert(
    left.data.cancelled_at === right.data.cancelled_at,
    "horodatage de clôture instable",
  );
  assert(
    (await countAudits(creance.id, "PAYMENT_RECEIVABLE_CANCELLED")) === 1,
    "audit concurrent dupliqué",
  );
  assert(
    (await countAudits(creance.id, "FOLLOW_UP_CASE_CLOSED")) === 1,
    "clôture concurrente dupliquée",
  );

  const replay = await tenantA.client.rpc("cancel_current_payment_receivable", {
    p_creance_id: creance.id,
  });
  if (replay.error || !replay.data) throw replay.error ?? new Error("replay absent");
  assert(
    replay.data.changed === false &&
      replay.data.dossier_changed === false &&
      replay.data.revoked_payment_link_count === 0,
    "replay a recréé un effet",
  );
});

await run("annulation refuse toute tentative Stripe non terminale sans effet partiel", async () => {
  const { creance } = await createDraft(tenantA, "annulation-en-vol");
  const opened = await openReceivable(tenantA, creance.id);
  const attempt = await admin
    .from("tentative_paiement")
    .insert({
      creance_id: creance.id,
      montant: creance.montant,
      moyen: "carte",
      source: "lien_agent",
      etat: "CREEE",
      payment_link_id: opened.payment_link_id,
    })
    .select("id")
    .single();
  if (attempt.error || !attempt.data) {
    throw attempt.error ?? new Error("tentative fixture absente");
  }

  const cancellation = await tenantA.client.rpc(
    "cancel_current_payment_receivable",
    { p_creance_id: creance.id },
  );
  assert(cancellation.error, "tentative en vol ignorée");

  const persistedCreance = await selectOne("creance", "etat", creance.id);
  const persistedLink = await selectOne(
    "payment_link",
    "status, revoked_at",
    opened.payment_link_id,
  );
  assert(persistedCreance.etat === "OUVERTE", "annulation partiellement écrite");
  assert(
    persistedLink.status === "active" && persistedLink.revoked_at === null,
    "lien révoqué malgré rollback",
  );
  assert(
    (await countAudits(creance.id, "PAYMENT_RECEIVABLE_CANCELLED")) === 0,
    "audit mensonger malgré rollback",
  );
});

await run("annulation refuse paiement partiel et fonds confirmés incohérents", async () => {
  const partial = await createDraft(tenantA, "annulation-partielle");
  await openReceivable(tenantA, partial.creance.id);
  const partialPayment = await admin.from("paiement").insert({
    creance_id: partial.creance.id,
    montant: 2_000,
    source: "lien_agent",
  });
  if (partialPayment.error) throw partialPayment.error;
  const partialState = await admin
    .from("creance")
    .update({ etat: "PARTIELLEMENT_REGLEE" })
    .eq("id", partial.creance.id);
  if (partialState.error) throw partialState.error;
  const partialCancel = await tenantA.client.rpc(
    "cancel_current_payment_receivable",
    { p_creance_id: partial.creance.id },
  );
  assert(partialCancel.error, "paiement partiel annulé");

  const inconsistent = await createDraft(tenantA, "annulation-fonds");
  await openReceivable(tenantA, inconsistent.creance.id);
  const confirmed = await admin.from("paiement").insert({
    creance_id: inconsistent.creance.id,
    montant: 1_000,
    source: "lien_agent",
  });
  if (confirmed.error) throw confirmed.error;
  const inconsistentCancel = await tenantA.client.rpc(
    "cancel_current_payment_receivable",
    { p_creance_id: inconsistent.creance.id },
  );
  assert(inconsistentCancel.error, "fonds confirmés ignorés sur état OUVERTE");
  const persisted = await selectOne("creance", "etat", inconsistent.creance.id);
  assert(persisted.etat === "OUVERTE", "fonds confirmés puis état annulé");
});

await run("annulation EN_LITIGE autorisée mais cross-tenant refusée", async () => {
  const { creance } = await createDraft(tenantA, "annulation-litige");
  await openReceivable(tenantA, creance.id);
  const disputed = await admin
    .from("creance")
    .update({ etat: "EN_LITIGE" })
    .eq("id", creance.id);
  if (disputed.error) throw disputed.error;

  const foreign = await tenantB.client.rpc("cancel_current_payment_receivable", {
    p_creance_id: creance.id,
  });
  assert(foreign.error, "annulation cross-tenant acceptée");
  const beforeOwn = await selectOne("creance", "etat", creance.id);
  assert(beforeOwn.etat === "EN_LITIGE", "cross-tenant a modifié l'état");

  const own = await tenantA.client.rpc("cancel_current_payment_receivable", {
    p_creance_id: creance.id,
  });
  if (own.error || !own.data) throw own.error ?? new Error("annulation litige absente");
  assert(own.data.creance_state === "ANNULEE", "litige non résolu en annulation");
});

await run("BROUILLON et états terminaux non annulables restent inchangés", async () => {
  const draft = await createDraft(tenantA, "annulation-brouillon");
  const draftCancel = await tenantA.client.rpc("cancel_current_payment_receivable", {
    p_creance_id: draft.creance.id,
  });
  assert(draftCancel.error, "BROUILLON annulé au lieu d'être archivé");
  const persistedDraft = await selectOne("creance", "etat", draft.creance.id);
  assert(persistedDraft.etat === "BROUILLON", "brouillon muté malgré refus");

  const settled = await createDraft(tenantA, "annulation-reglee");
  await openReceivable(tenantA, settled.creance.id);
  const settledState = await admin
    .from("creance")
    .update({ etat: "REGLEE" })
    .eq("id", settled.creance.id);
  if (settledState.error) throw settledState.error;
  const settledCancel = await tenantA.client.rpc(
    "cancel_current_payment_receivable",
    { p_creance_id: settled.creance.id },
  );
  assert(settledCancel.error, "REGLEE réécrite en ANNULEE");
  const persistedSettled = await selectOne("creance", "etat", settled.creance.id);
  assert(persistedSettled.etat === "REGLEE", "état terminal régressé");
});

await run("règlement hors Sidian explicitement absent du MVP", async () => {
  const enumLabels = await postgres.query(
    `select e.enumlabel
     from pg_catalog.pg_enum as e
     join pg_catalog.pg_type as t on t.oid = e.enumtypid
     join pg_catalog.pg_namespace as n on n.oid = t.typnamespace
     where n.nspname = 'public'
       and t.typname = 'paiement_source'
     order by e.enumsortorder`,
  );
  const labels = enumLabels.rows.map((row) => row.enumlabel);
  assert(labels.includes("detecte_hors_sidian"), "enum historique supprimé");
  assert(
    !labels.includes("declare_manuellement_hors_sidian"),
    "source manuelle hors MVP ajoutée",
  );

  const functions = await postgres.query(
    `select p.proname
     from pg_catalog.pg_proc as p
     join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (
         p.proname ilike '%hors_sidian%'
         or p.proname ilike '%outside_sidian%'
       )`,
  );
  assert(functions.rowCount === 0, "RPC hors Sidian exposée au MVP");
});

await run("anon ne peut appeler aucune commande SID-PROD-002", async () => {
  for (const [name, args] of [
    ["ensure_current_dossier_suivi", { p_creance_id: randomUUID() }],
    [
      "update_current_dossier_suivi",
      {
        p_creance_id: randomUUID(),
        p_target_state: "PREVENTION",
        p_next_action_at: null,
        p_escalation_reason: null,
      },
    ],
    ["cancel_current_payment_receivable", { p_creance_id: randomUUID() }],
  ]) {
    const response = await anon.rpc(name, args);
    assert(response.error, `${name}: anon autorisé`);
  }
});

await postgres.end();

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} tests SID-PROD-002 réussis`);
if (failed.length > 0) {
  for (const result of failed) {
    console.error(`- ${result.name}: ${result.message}`);
  }
  process.exitCode = 1;
}
