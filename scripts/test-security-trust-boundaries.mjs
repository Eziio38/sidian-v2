#!/usr/bin/env node
/**
 * SID-SEC-002..005 — frontières de confiance, Supabase local uniquement.
 *
 * Vérifie avec de vrais JWT authenticated que les tables probatoires et les
 * machines d'état ne sont plus mutables via PostgREST. Le rôle service_role
 * ne sert qu'aux fixtures et aux assertions des invariants SQL.
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
const SUPABASE_URL = localConfig.url;

function localClient(key, options = {}) {
  return createClient(SUPABASE_URL, key, withLocalOnlyFetch(options));
}

const admin = localClient(LOCAL_DEMO_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const postgres = createLocalPgClient(resolveLocalPostgresUrl(), pg);

const TRUST_BOUNDARY_TABLES = [
  "audit_log",
  "message",
  "approval_request",
  "regle",
  "dossier_suivi",
  "conversation",
];

const results = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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

async function createTenant(label) {
  const password = "TrustBoundary123!";
  const email = `trust-${label}-${Date.now()}-${randomUUID()}@sidian.test`;
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
      nom: `Agence ${label}`,
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

async function insertOne(table, values, columns = "id") {
  const response = await admin.from(table).insert(values).select(columns).single();
  if (response.error || !response.data) {
    throw response.error ?? new Error(`${table}_fixture_failed`);
  }
  return response.data;
}

await postgres.connect();

let tenantA;
let tenantB;
let clientPayeurA;
let creanceA;
let creanceWithoutDossier;
let conversationA;
let messageA;
let approvalA;
let ruleA;
let dossierA;
let auditA;

await run("fixtures service_role restent autorisées", async () => {
  tenantA = await createTenant("A");
  tenantB = await createTenant("B");

  clientPayeurA = await insertOne("client_payeur", {
    prestataire_id: tenantA.prestataireId,
    nom: "Client A",
    email: `client-${randomUUID()}@example.com`,
  });
  creanceA = await insertOne("creance", {
    prestataire_id: tenantA.prestataireId,
    client_payeur_id: clientPayeurA.id,
    montant: 10000,
    origine: "import_manuel",
    date_echeance: "2026-08-15",
    etat: "OUVERTE",
  });
  creanceWithoutDossier = await insertOne("creance", {
    prestataire_id: tenantA.prestataireId,
    client_payeur_id: clientPayeurA.id,
    montant: 20000,
    origine: "import_manuel",
    date_echeance: "2026-08-20",
    etat: "OUVERTE",
  });
  conversationA = await insertOne("conversation", {
    prestataire_id: tenantA.prestataireId,
    creance_id: creanceA.id,
    client_payeur_id: clientPayeurA.id,
  });
  messageA = await insertOne("message", {
    conversation_id: conversationA.id,
    emetteur: "agent",
    contenu: "Message serveur vérifiable",
    canal: "email",
    actor_type: "sidian_agent",
  });
  approvalA = await insertOne(
    "approval_request",
    {
      prestataire_id: tenantA.prestataireId,
      creance_id: creanceA.id,
      type: "rule_change",
      requested_by_actor_type: "sidian_agent",
      requested_by_provider: "trust-boundary-test",
      payload: { version: 1, proposed: "delai_grace=7" },
    },
    "id, payload, prestataire_id, creance_id, type, status",
  );
  ruleA = await insertOne("regle", {
    prestataire_id: tenantA.prestataireId,
    client_payeur_id: clientPayeurA.id,
    parametre: "delai_grace",
    valeur: { jours: 5 },
    origine: "defaut",
  });
  dossierA = await insertOne("dossier_suivi", {
    creance_id: creanceA.id,
    etat: "PREVENTION",
  });
  auditA = await insertOne("audit_log", {
    prestataire_id: tenantA.prestataireId,
    actor_type: "system",
    actor_provider: "stripe",
    action: "trust_boundary_fixture",
    entity_type: "creance",
    entity_id: creanceA.id,
  });
});

await run("ACL authenticated = SELECT seul et aucune policy DML résiduelle", async () => {
  for (const table of TRUST_BOUNDARY_TABLES) {
    const relation = `public.${table}`;
    const privileges = await postgres.query(
      `select
         has_table_privilege('authenticated', $1, 'SELECT') as can_select,
         has_table_privilege('authenticated', $1, 'INSERT') as can_insert,
         has_table_privilege('authenticated', $1, 'UPDATE') as can_update,
         has_table_privilege('authenticated', $1, 'DELETE') as can_delete,
         has_table_privilege('authenticated', $1, 'TRUNCATE') as can_truncate,
         has_table_privilege('authenticated', $1, 'REFERENCES') as can_reference,
         has_table_privilege('authenticated', $1, 'TRIGGER') as can_trigger`,
      [relation],
    );
    const acl = privileges.rows[0];
    assert(acl.can_select === true, `${table}: SELECT absent`);
    for (const key of [
      "can_insert",
      "can_update",
      "can_delete",
      "can_truncate",
      "can_reference",
      "can_trigger",
    ]) {
      assert(acl[key] === false, `${table}: privilège ${key} résiduel`);
    }

    const policies = await postgres.query(
      `select p.polname
       from pg_catalog.pg_policy as p
       join pg_catalog.pg_class as c on c.oid = p.polrelid
       join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = $1
         and p.polcmd in ('a', 'w', 'd')`,
      [table],
    );
    assert(policies.rowCount === 0, `${table}: policy DML résiduelle`);

    const columns = await postgres.query(
      `select 1
       from information_schema.column_privileges
       where grantee = 'authenticated'
         and table_schema = 'public'
         and table_name = $1
         and privilege_type in ('INSERT', 'UPDATE')
       limit 1`,
      [table],
    );
    assert(columns.rowCount === 0, `${table}: grant colonne DML résiduel`);
  }
});

await run("RLS SELECT propre au tenant est préservée", async () => {
  const ownChecks = [
    ["audit_log", auditA.id],
    ["message", messageA.id],
    ["approval_request", approvalA.id],
    ["regle", ruleA.id],
    ["dossier_suivi", dossierA.id],
    ["conversation", conversationA.id],
  ];

  for (const [table, id] of ownChecks) {
    const own = await tenantA.client.from(table).select("id").eq("id", id);
    if (own.error) throw own.error;
    assert(own.data?.length === 1, `${table}: ligne propre invisible`);

    const foreign = await tenantB.client.from(table).select("id").eq("id", id);
    if (foreign.error) throw foreign.error;
    assert(foreign.data?.length === 0, `${table}: fuite cross-tenant`);
  }
});

await run("SID-SEC-002 audit_log INSERT navigateur refusé", async () => {
  const response = await tenantA.client.from("audit_log").insert({
    prestataire_id: tenantA.prestataireId,
    actor_type: "human",
    action: "forged_audit",
    entity_type: "creance",
    entity_id: creanceA.id,
  });
  assert(response.error, "audit_log forgé accepté");
});

await run("SID-SEC-004 provenance message navigateur refusée", async () => {
  const response = await tenantA.client.from("message").insert({
    conversation_id: conversationA.id,
    emetteur: "agent",
    contenu: "Je prétends venir de l'agent",
    canal: "interface",
    actor_type: "sidian_agent",
  });
  assert(response.error, "message agent forgé accepté");
});

await run("SID-SEC-003 création et mutation approval_request navigateur refusées", async () => {
  const inserted = await tenantA.client.from("approval_request").insert({
    prestataire_id: tenantA.prestataireId,
    creance_id: creanceA.id,
    type: "formal_action",
    requested_by_actor_type: "human",
    payload: { forged: true },
  });
  assert(inserted.error, "approval_request forgée acceptée");

  const updated = await tenantA.client
    .from("approval_request")
    .update({ payload: { forged: true }, status: "approved" })
    .eq("id", approvalA.id);
  assert(updated.error, "approval_request mutée directement");
});

await run("SID-SEC-005 règles/dossier/conversation DML navigateur refusé", async () => {
  const ruleInsert = await tenantA.client.from("regle").insert({
    prestataire_id: tenantA.prestataireId,
    parametre: "delai_grace",
    valeur: { jours: 99 },
  });
  assert(ruleInsert.error, "regle insérée directement");

  const ruleDelete = await tenantA.client.from("regle").delete().eq("id", ruleA.id);
  assert(ruleDelete.error, "regle supprimée directement");

  const dossierInsert = await tenantA.client.from("dossier_suivi").insert({
    creance_id: creanceWithoutDossier.id,
    etat: "ESCALADE_HUMAINE",
  });
  assert(dossierInsert.error, "dossier_suivi inséré directement");

  const dossierUpdate = await tenantA.client
    .from("dossier_suivi")
    .update({ etat: "CLOS" })
    .eq("id", dossierA.id);
  assert(dossierUpdate.error, "dossier_suivi transitionné directement");

  const conversationInsert = await tenantA.client.from("conversation").insert({
    prestataire_id: tenantA.prestataireId,
    creance_id: creanceA.id,
    client_payeur_id: clientPayeurA.id,
  });
  assert(conversationInsert.error, "conversation insérée directement");

  const conversationUpdate = await tenantA.client
    .from("conversation")
    .update({ creance_id: null })
    .eq("id", conversationA.id);
  assert(conversationUpdate.error, "conversation réattachée directement");
});

await run("guard SQL refuse création terminale et mutation du payload/identité", async () => {
  const terminalInsert = await admin.from("approval_request").insert({
    prestataire_id: tenantA.prestataireId,
    creance_id: creanceA.id,
    type: "autre",
    requested_by_actor_type: "system",
    payload: { invalid: true },
    status: "approved",
    approved_by: tenantA.userId,
    decided_at: new Date().toISOString(),
  });
  assert(terminalInsert.error, "approval_request créée terminale");

  const payloadUpdate = await admin
    .from("approval_request")
    .update({ payload: { version: 2 } })
    .eq("id", approvalA.id);
  assert(payloadUpdate.error, "payload muté par UPDATE");

  const identityUpdate = await admin
    .from("approval_request")
    .update({ type: "formal_action" })
    .eq("id", approvalA.id);
  assert(identityUpdate.error, "identité mutée par UPDATE");

  const persisted = await admin
    .from("approval_request")
    .select("payload, type, prestataire_id, creance_id, status")
    .eq("id", approvalA.id)
    .single();
  if (persisted.error || !persisted.data) throw persisted.error;
  assert(persisted.data.payload.version === 1, "payload altéré malgré le guard");
  assert(persisted.data.type === "rule_change", "type altéré malgré le guard");
  assert(persisted.data.status === "pending", "statut altéré malgré le guard");
});

await run("RPC décision refuse anon, cross-tenant et décision hors allowlist", async () => {
  const anon = localClient(LOCAL_DEMO_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anonDecision = await anon.rpc("decide_current_approval_request", {
    p_approval_request_id: approvalA.id,
    p_decision: "approved",
  });
  assert(anonDecision.error, "RPC accessible à anon");

  const crossTenant = await tenantB.client.rpc("decide_current_approval_request", {
    p_approval_request_id: approvalA.id,
    p_decision: "approved",
  });
  assert(crossTenant.error, "décision cross-tenant acceptée");

  const invalid = await tenantA.client.rpc("decide_current_approval_request", {
    p_approval_request_id: approvalA.id,
    p_decision: "pending",
  });
  assert(invalid.error, "transition pending acceptée comme décision");

  const privileged = await admin.rpc("decide_current_approval_request", {
    p_approval_request_id: approvalA.id,
    p_decision: "approved",
  });
  assert(privileged.error, "RPC de décision accessible à service_role");
});

await run("RPC décision lie approved_by au JWT et rejoue idempotemment", async () => {
  const first = await tenantA.client.rpc("decide_current_approval_request", {
    p_approval_request_id: approvalA.id,
    p_decision: "approved",
  });
  if (first.error) throw first.error;

  const decided = await admin
    .from("approval_request")
    .select("status, approved_by, decided_at, payload, prestataire_id, creance_id, type")
    .eq("id", approvalA.id)
    .single();
  if (decided.error || !decided.data) throw decided.error;
  assert(decided.data.status === "approved", "statut non approuvé");
  assert(decided.data.approved_by === tenantA.userId, "approved_by ne vient pas du JWT");
  assert(decided.data.decided_at, "decided_at absent");
  assert(decided.data.payload.version === 1, "payload modifié par la décision");
  const firstDecidedAt = decided.data.decided_at;

  const firstAudits = await admin
    .from("audit_log")
    .select("id, actor_type, action, metadata", { count: "exact" })
    .eq("entity_type", "approval_request")
    .eq("entity_id", approvalA.id);
  if (firstAudits.error) throw firstAudits.error;
  assert(firstAudits.count === 1, "audit de décision absent ou dupliqué");
  assert(firstAudits.data?.[0]?.actor_type === "human", "acteur audit incorrect");
  assert(
    firstAudits.data?.[0]?.action === "APPROVAL_REQUEST_APPROVED",
    "action audit d'approbation incorrecte",
  );
  assert(
    firstAudits.data?.[0]?.metadata?.decided_by_user_id === tenantA.userId,
    "décideur JWT absent de l'audit",
  );

  const replay = await tenantA.client.rpc("decide_current_approval_request", {
    p_approval_request_id: approvalA.id,
    p_decision: "approved",
  });
  if (replay.error) throw replay.error;

  const replayed = await admin
    .from("approval_request")
    .select("status, approved_by, decided_at")
    .eq("id", approvalA.id)
    .single();
  if (replayed.error || !replayed.data) throw replayed.error;
  assert(replayed.data.decided_at === firstDecidedAt, "replay a réécrit decided_at");

  const replayAudits = await admin
    .from("audit_log")
    .select("id", { count: "exact" })
    .eq("entity_type", "approval_request")
    .eq("entity_id", approvalA.id);
  if (replayAudits.error) throw replayAudits.error;
  assert(replayAudits.count === 1, "replay a dupliqué l'audit");

  const reversal = await tenantA.client.rpc("decide_current_approval_request", {
    p_approval_request_id: approvalA.id,
    p_decision: "rejected",
  });
  assert(reversal.error, "décision terminale inversée");

  const serverReversal = await admin
    .from("approval_request")
    .update({ status: "rejected" })
    .eq("id", approvalA.id);
  assert(serverReversal.error, "guard terminal contourné par UPDATE serveur");
});

await run("RPC décision rejette et expire avec des identités cohérentes", async () => {
  const rejection = await insertOne("approval_request", {
    prestataire_id: tenantA.prestataireId,
    creance_id: creanceA.id,
    type: "autre",
    requested_by_actor_type: "system",
    payload: { decision: "reject" },
  });
  const rejected = await tenantA.client.rpc("decide_current_approval_request", {
    p_approval_request_id: rejection.id,
    p_decision: "rejected",
  });
  if (rejected.error) throw rejected.error;

  const rejectedRow = await admin
    .from("approval_request")
    .select("status, approved_by, decided_at")
    .eq("id", rejection.id)
    .single();
  if (rejectedRow.error || !rejectedRow.data) throw rejectedRow.error;
  assert(rejectedRow.data.status === "rejected", "rejet non enregistré");
  assert(rejectedRow.data.approved_by === tenantA.userId, "décideur du rejet incorrect");
  assert(rejectedRow.data.decided_at, "horodatage du rejet absent");

  const rejectionAudits = await admin
    .from("audit_log")
    .select("id, actor_type, action", { count: "exact" })
    .eq("entity_type", "approval_request")
    .eq("entity_id", rejection.id);
  if (rejectionAudits.error) throw rejectionAudits.error;
  assert(rejectionAudits.count === 1, "audit du rejet absent ou dupliqué");
  assert(rejectionAudits.data?.[0]?.actor_type === "human", "acteur rejet incorrect");
  assert(
    rejectionAudits.data?.[0]?.action === "APPROVAL_REQUEST_REJECTED",
    "action audit de rejet incorrecte",
  );

  const expired = await insertOne("approval_request", {
    prestataire_id: tenantA.prestataireId,
    creance_id: creanceA.id,
    type: "autre",
    requested_by_actor_type: "system",
    payload: { decision: "expired" },
    expires_at: "2026-01-01T00:00:00.000Z",
  });

  const latePrivilegedDecision = await admin
    .from("approval_request")
    .update({
      status: "approved",
      approved_by: tenantA.userId,
      decided_at: new Date().toISOString(),
    })
    .eq("id", expired.id);
  assert(latePrivilegedDecision.error, "décision privilégiée après expiration acceptée");

  const expiration = await tenantA.client.rpc("decide_current_approval_request", {
    p_approval_request_id: expired.id,
    p_decision: "approved",
  });
  if (expiration.error) throw expiration.error;

  const expiredRow = await admin
    .from("approval_request")
    .select("status, approved_by, decided_at")
    .eq("id", expired.id)
    .single();
  if (expiredRow.error || !expiredRow.data) throw expiredRow.error;
  assert(expiredRow.data.status === "expired", "expiration non enregistrée");
  assert(expiredRow.data.approved_by === null, "expiration attribuée à un approbateur");
  assert(expiredRow.data.decided_at, "horodatage expiration absent");

  const expirationReplay = await tenantA.client.rpc(
    "decide_current_approval_request",
    {
      p_approval_request_id: expired.id,
      p_decision: "approved",
    },
  );
  if (expirationReplay.error) throw expirationReplay.error;
  assert(
    expirationReplay.data?.decided_at === expiredRow.data.decided_at,
    "replay d'expiration a réécrit decided_at",
  );

  const expirationAudits = await admin
    .from("audit_log")
    .select("id, actor_type, action", { count: "exact" })
    .eq("entity_type", "approval_request")
    .eq("entity_id", expired.id);
  if (expirationAudits.error) throw expirationAudits.error;
  assert(expirationAudits.count === 1, "audit d'expiration absent ou dupliqué");
  assert(expirationAudits.data?.[0]?.actor_type === "system", "acteur expiration incorrect");
  assert(
    expirationAudits.data?.[0]?.action === "APPROVAL_REQUEST_EXPIRED",
    "action audit d'expiration incorrecte",
  );

  const futureExpiry = new Date(Date.now() + 60_000).toISOString();
  const notExpired = await insertOne("approval_request", {
    prestataire_id: tenantA.prestataireId,
    creance_id: creanceA.id,
    type: "autre",
    requested_by_actor_type: "system",
    payload: { decision: "too_early" },
    expires_at: futureExpiry,
  });
  const earlyExpiry = await admin
    .from("approval_request")
    .update({
      status: "expired",
      approved_by: null,
      decided_at: new Date().toISOString(),
    })
    .eq("id", notExpired.id);
  assert(earlyExpiry.error, "expiration privilégiée anticipée acceptée");
});

await run("suppression d'une créance conserve l'approbation avec SET NULL", async () => {
  const deletableCreance = await insertOne("creance", {
    prestataire_id: tenantA.prestataireId,
    client_payeur_id: clientPayeurA.id,
    montant: 30000,
    origine: "import_manuel",
    date_echeance: "2026-08-30",
    etat: "BROUILLON",
  });
  const retainedApproval = await insertOne("approval_request", {
    prestataire_id: tenantA.prestataireId,
    creance_id: deletableCreance.id,
    type: "autre",
    requested_by_actor_type: "system",
    payload: { retention: true },
  });

  const deletion = await admin.from("creance").delete().eq("id", deletableCreance.id);
  if (deletion.error) throw deletion.error;

  const retained = await admin
    .from("approval_request")
    .select("creance_id, status, payload")
    .eq("id", retainedApproval.id)
    .single();
  if (retained.error || !retained.data) throw retained.error;
  assert(retained.data.creance_id === null, "SET NULL de la FK bloqué");
  assert(retained.data.status === "pending", "statut modifié pendant SET NULL");
  assert(retained.data.payload.retention === true, "payload altéré pendant SET NULL");
});

await postgres.end();

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} tests réussis`);
if (failed.length > 0) process.exit(1);
