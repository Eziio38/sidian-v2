#!/usr/bin/env node

/**
 * Harnais SQL du cycle de vie d'un compte (RGPD).
 *
 * Deux propriétés sont vérifiées ici, et elles sont indissociables :
 *
 *   1. ISOLATION — l'export ne peut, en aucune circonstance, contenir les
 *      données d'un autre prestataire, et la clôture d'un compte n'altère rien
 *      chez le voisin.
 *
 *   2. HONNÊTETÉ — la clôture est une anonymisation PARTIELLE. Les pièces
 *      comptables restent en base. Ce script l'affirme explicitement : si un
 *      jour quelqu'un décide de les effacer, ce test tombe et la décision
 *      devra être assumée, pas subie.
 */

import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import {
  assertLocalTestConfig,
  LOCAL_DEMO_ANON_KEY,
  LOCAL_DEMO_SERVICE_ROLE_KEY,
} from "./lib/assert-local-supabase.mjs";
import { withLocalOnlyFetch } from "./lib/local-only-fetch.mjs";

const localConfig = assertLocalTestConfig();

function localClient(key, options = {}) {
  return createClient(
    localConfig.url,
    key,
    withLocalOnlyFetch({
      auth: { autoRefreshToken: false, persistSession: false },
      ...options,
    }),
  );
}

const admin = localClient(LOCAL_DEMO_SERVICE_ROLE_KEY);

let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
}

async function createUser(email, password) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("user_create_failed");
  return data.user;
}

async function signIn(email, password) {
  const auth = localClient(LOCAL_DEMO_ANON_KEY);
  const { data, error } = await auth.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.session) throw error ?? new Error("sign_in_failed");
  return localClient(LOCAL_DEMO_ANON_KEY, {
    global: {
      headers: { Authorization: `Bearer ${data.session.access_token}` },
    },
  });
}

async function insertOne(table, values, columns = "id") {
  const { data, error } = await admin
    .from(table)
    .insert(values)
    .select(columns)
    .single();
  if (error || !data) throw error ?? new Error(`${table}_insert_failed`);
  return data;
}

/** Jeu de données complet pour un prestataire : client, créance, paiement, conversation, message, document. */
async function seedTenant(label, email) {
  const user = await createUser(email, "AccountLifecycle123!");
  const prestataire = await insertOne("prestataire", {
    user_id: user.id,
    nom: `Cabinet ${label}`,
    email,
  });

  const client = await insertOne("client_payeur", {
    prestataire_id: prestataire.id,
    nom: `Client ${label}`,
    email: `client-${label}@sidian.test`,
  });

  const creance = await insertOne("creance", {
    prestataire_id: prestataire.id,
    client_payeur_id: client.id,
    montant: 125_000,
    origine: "facture_externe",
    date_echeance: "2026-09-30",
    etat: "OUVERTE",
    libelle: `Facture ${label}`,
  });

  const paiement = await insertOne("paiement", {
    creance_id: creance.id,
    montant: 25_000,
    source: "detecte_hors_sidian",
  });

  const conversation = await insertOne(
    "conversation",
    {
      prestataire_id: prestataire.id,
      title: `Suivi ${label}`,
    },
    "id, title",
  );

  const message = await insertOne(
    "message",
    {
      conversation_id: conversation.id,
      emetteur: "prestataire",
      canal: "interface",
      actor_type: "human",
      contenu: `Contenu confidentiel de ${label}`,
    },
    "id, contenu",
  );

  const documentId = randomUUID();
  const document = await insertOne(
    "document",
    {
      id: documentId,
      prestataire_id: prestataire.id,
      creance_id: creance.id,
      storage_path: `${prestataire.id}/${documentId}/facture-${label}.pdf`,
      original_filename: `facture-${label}.pdf`,
      mime_type: "application/pdf",
      size_bytes: 2048,
      status: "awaiting_processing",
      uploaded_by: user.id,
    },
    "id, storage_path, status, deleted_at",
  );

  return {
    user,
    email,
    prestataire,
    client,
    creance,
    paiement,
    conversation,
    message,
    document,
  };
}

async function adminRow(table, id, columns) {
  const { data, error } = await admin
    .from(table)
    .select(columns)
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

async function main() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const a = await seedTenant("A", `account-a-${suffix}@sidian.test`);
  const b = await seedTenant("B", `account-b-${suffix}@sidian.test`);

  const clientA = await signIn(a.email, "AccountLifecycle123!");
  const clientB = await signIn(b.email, "AccountLifecycle123!");

  // -------------------------------------------------------------------------
  // 1. Export — contenu et isolation
  // -------------------------------------------------------------------------

  const { data: exportA, error: exportAError } = await clientA.rpc(
    "export_current_account_data",
  );
  if (exportAError) throw exportAError;

  assert(
    exportA.profile.id === a.prestataire.id,
    "l'export ne porte pas le profil du prestataire authentifié",
  );
  assert(
    exportA.clients.length === 1 && exportA.clients[0].id === a.client.id,
    "l'export ne contient pas le client du prestataire",
  );
  assert(
    exportA.creances.length === 1 && exportA.creances[0].id === a.creance.id,
    "l'export ne contient pas la créance du prestataire",
  );
  assert(
    exportA.payments.length === 1 && exportA.payments[0].id === a.paiement.id,
    "l'export ne contient pas le paiement du prestataire",
  );
  assert(
    exportA.conversations.length === 1 &&
      exportA.conversations[0].id === a.conversation.id,
    "l'export ne contient pas la conversation du prestataire",
  );
  assert(
    exportA.messages.length === 1 && exportA.messages[0].id === a.message.id,
    "l'export ne contient pas le message du prestataire",
  );
  assert(
    exportA.documents.length === 1 && exportA.documents[0].id === a.document.id,
    "l'export ne contient pas les métadonnées du document",
  );
  assert(
    exportA.documents[0].storage_path === undefined,
    "l'export révèle le chemin de stockage interne du document",
  );

  const serialisedA = JSON.stringify(exportA);
  assert(
    !serialisedA.includes(b.prestataire.id) &&
      !serialisedA.includes(b.client.id) &&
      !serialisedA.includes(b.creance.id) &&
      !serialisedA.includes(b.conversation.id) &&
      !serialisedA.includes(b.message.id) &&
      !serialisedA.includes(b.document.id) &&
      !serialisedA.includes(b.email),
    "l'export de A contient des données de B",
  );
  assert(
    typeof exportA.notice === "object" && exportA.notice.extraction.length > 0,
    "l'export ne dit pas qu'aucun contenu de document n'est analysé",
  );

  const anonymous = localClient(LOCAL_DEMO_ANON_KEY);
  const { error: anonExportError } = await anonymous.rpc(
    "export_current_account_data",
  );
  assert(
    Boolean(anonExportError),
    "un appelant anonyme peut exporter des données de compte",
  );

  const { error: anonCloseError } = await anonymous.rpc(
    "close_current_account",
  );
  assert(
    Boolean(anonCloseError),
    "un appelant anonyme peut clôturer un compte",
  );

  const { error: serviceRoleCloseError } = await admin.rpc(
    "close_current_account",
  );
  assert(
    Boolean(serviceRoleCloseError),
    "service_role peut clôturer un compte sans session utilisateur",
  );

  // -------------------------------------------------------------------------
  // 2. Clôture de A
  // -------------------------------------------------------------------------

  const { data: closure, error: closureError } = await clientA.rpc(
    "close_current_account",
  );
  if (closureError) throw closureError;

  assert(
    closure.prestataire_id === a.prestataire.id && closure.already_closed === false,
    "le rapport de clôture ne désigne pas le compte clôturé",
  );
  assert(
    Array.isArray(closure.storage_paths) &&
      closure.storage_paths.length === 1 &&
      closure.storage_paths[0] === a.document.storage_path,
    "la clôture ne restitue pas les chemins de stockage à purger",
  );
  assert(
    closure.retained_for_legal_obligation.clients === 1 &&
      closure.retained_for_legal_obligation.creances === 1 &&
      closure.retained_for_legal_obligation.payments === 1,
    "le rapport de clôture masque les pièces comptables conservées",
  );
  assert(
    closure.anonymised.documents_soft_deleted === 1 &&
      closure.anonymised.messages_erased === 1 &&
      closure.anonymised.conversations_cleared === 1,
    "le rapport de clôture ne décompte pas ce qui a été anonymisé",
  );

  // -------------------------------------------------------------------------
  // 3. Effets réellement appliqués
  // -------------------------------------------------------------------------

  const prestataireAfter = await adminRow(
    "prestataire",
    a.prestataire.id,
    "nom, email, account_status, closed_at, anonymised_at",
  );
  assert(
    prestataireAfter.account_status === "closed" &&
      prestataireAfter.closed_at !== null &&
      prestataireAfter.anonymised_at !== null,
    "le compte n'est pas marqué clôturé",
  );
  assert(
    prestataireAfter.nom === "Compte clôturé" &&
      prestataireAfter.email === `compte-clos+${a.prestataire.id}@sidian.invalid`,
    "l'identité du titulaire n'est pas anonymisée",
  );

  const messageAfter = await adminRow("message", a.message.id, "contenu");
  assert(
    messageAfter.contenu === "[contenu supprimé à la clôture du compte]",
    "le contenu conversationnel n'est pas effacé",
  );

  const conversationAfter = await adminRow(
    "conversation",
    a.conversation.id,
    "title",
  );
  assert(
    conversationAfter.title === null,
    "le titre de conversation n'est pas effacé",
  );

  const documentAfter = await adminRow(
    "document",
    a.document.id,
    "status, deleted_at",
  );
  assert(
    documentAfter.status === "deleted" && documentAfter.deleted_at !== null,
    "les documents ne sont pas supprimés logiquement",
  );

  // Conservation légale — assertion volontairement explicite.
  const creanceAfter = await adminRow(
    "creance",
    a.creance.id,
    "montant, etat, archived_at",
  );
  assert(
    creanceAfter.montant === 125_000,
    "une créance a été altérée par la clôture (pièce comptable)",
  );
  const clientAfter = await adminRow("client_payeur", a.client.id, "nom, email");
  assert(
    clientAfter.nom === "Client A",
    "l'identité de la contrepartie comptable a été effacée alors qu'elle est conservée par obligation légale",
  );
  const paiementAfter = await adminRow("paiement", a.paiement.id, "montant");
  assert(
    paiementAfter.montant === 25_000,
    "un paiement a été altéré par la clôture (pièce comptable)",
  );

  const { data: auditRows, error: auditError } = await admin
    .from("audit_log")
    .select("action, metadata")
    .eq("prestataire_id", a.prestataire.id)
    .eq("action", "account.closed");
  if (auditError) throw auditError;
  assert(
    (auditRows ?? []).length === 1 &&
      auditRows[0].metadata.retention_reason === "obligation_comptable_l123_22",
    "la clôture n'est pas tracée dans audit_log avec son motif de rétention",
  );

  // -------------------------------------------------------------------------
  // 3 bis. L'immuabilité des messages reste entière hors clôture
  // -------------------------------------------------------------------------

  // La clôture obtient une dérogation locale à sa transaction. Si elle fuitait,
  // n'importe quelle écriture pourrait réécrire l'historique : ces assertions
  // sont le garde-fou de cette dérogation.
  const { error: updateMessageError } = await admin
    .from("message")
    .update({ contenu: "Réécriture interdite" })
    .eq("id", b.message.id);
  assert(
    Boolean(updateMessageError),
    "un message peut être réécrit hors clôture de compte",
  );

  const { error: updateClosedMessageError } = await admin
    .from("message")
    .update({ contenu: "Réécriture interdite" })
    .eq("id", a.message.id);
  assert(
    Boolean(updateClosedMessageError),
    "la dérogation de clôture survit à la transaction qui l'a posée",
  );

  const { error: deleteMessageError } = await admin
    .from("message")
    .delete()
    .eq("id", a.message.id);
  assert(
    Boolean(deleteMessageError),
    "la clôture a ouvert la suppression de messages, qui doit rester interdite",
  );

  // -------------------------------------------------------------------------
  // 4. Révocation d'accès
  // -------------------------------------------------------------------------

  const { data: resolvedTenant, error: resolvedTenantError } = await clientA.rpc(
    "current_prestataire_id",
  );
  if (resolvedTenantError) throw resolvedTenantError;
  assert(
    resolvedTenant === null,
    "un compte clôturé résout encore un prestataire courant",
  );

  for (const table of ["creance", "client_payeur", "conversation", "document"]) {
    const { data: rows, error } = await clientA.from(table).select("id");
    if (error) throw error;
    assert(
      (rows ?? []).length === 0,
      `un compte clôturé lit encore la table ${table}`,
    );
  }

  const { error: exportAfterCloseError } = await clientA.rpc(
    "export_current_account_data",
  );
  assert(
    Boolean(exportAfterCloseError) &&
      String(exportAfterCloseError.message).includes("account_closed"),
    "un compte clôturé peut encore exporter ses données",
  );

  // -------------------------------------------------------------------------
  // 5. L'anonymisation ne peut pas être annulée par une simple reconnexion
  // -------------------------------------------------------------------------

  const { error: ensureError } = await clientA.rpc(
    "ensure_prestataire_for_current_user",
    { p_nom: "Tentative de réouverture" },
  );
  // L'appel peut réussir ou échouer ; ce qui compte, c'est l'état final.
  void ensureError;

  const prestataireAfterEnsure = await adminRow(
    "prestataire",
    a.prestataire.id,
    "nom, email, account_status",
  );
  assert(
    prestataireAfterEnsure.email ===
      `compte-clos+${a.prestataire.id}@sidian.invalid` &&
      prestataireAfterEnsure.nom === "Compte clôturé" &&
      prestataireAfterEnsure.account_status === "closed",
    "une reconnexion réécrit l'identité anonymisée",
  );

  // -------------------------------------------------------------------------
  // 6. Idempotence
  // -------------------------------------------------------------------------

  const { data: secondClosure, error: secondClosureError } = await clientA.rpc(
    "close_current_account",
  );
  if (secondClosureError) throw secondClosureError;
  assert(
    secondClosure.already_closed === true,
    "une seconde clôture n'est pas idempotente",
  );

  // -------------------------------------------------------------------------
  // 7. Le voisin est intact
  // -------------------------------------------------------------------------

  const { data: exportB, error: exportBError } = await clientB.rpc(
    "export_current_account_data",
  );
  if (exportBError) throw exportBError;
  assert(
    exportB.profile.id === b.prestataire.id &&
      exportB.clients.length === 1 &&
      exportB.messages.length === 1 &&
      exportB.messages[0].contenu === "Contenu confidentiel de B",
    "la clôture de A a altéré les données de B",
  );
  assert(
    !JSON.stringify(exportB).includes(a.prestataire.id),
    "l'export de B contient des données de A",
  );

  const prestataireB = await adminRow(
    "prestataire",
    b.prestataire.id,
    "account_status, nom",
  );
  assert(
    prestataireB.account_status === "active" && prestataireB.nom === "Cabinet B",
    "la clôture de A a clôturé le compte de B",
  );

  console.log(`✓ Cycle de vie du compte (RGPD) : ${passed} assertions.`);
}

main().catch((error) => {
  console.error("✗ test-account-lifecycle", error);
  process.exitCode = 1;
});
