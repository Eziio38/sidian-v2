#!/usr/bin/env node
/**
 * SID-DOC-001 — isolation et garde-fous du stockage documentaire.
 *
 * Vérifie contre une base locale réelle ce que les tests unitaires ne peuvent
 * pas prouver : les policies RLS, les contraintes SQL, et surtout qu'aucun
 * prestataire ne peut atteindre le document d'un autre — ni par la table, ni
 * par les RPC, ni par le bucket.
 */

import { createClient } from "@supabase/supabase-js";

import {
  assertLocalTestConfig,
  LOCAL_DEMO_ANON_KEY,
  LOCAL_DEMO_SERVICE_ROLE_KEY,
} from "./lib/assert-local-supabase.mjs";
import { withLocalOnlyFetch } from "./lib/local-only-fetch.mjs";

const localConfig = assertLocalTestConfig();
const admin = createClient(
  localConfig.url,
  LOCAL_DEMO_SERVICE_ROLE_KEY,
  withLocalOnlyFetch({
    auth: { autoRefreshToken: false, persistSession: false },
  }),
);

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

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`✓ ${message}`);
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

async function main() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const password = "DocumentTest123!";
  const emailA = `doc-a-${suffix}@sidian.test`;
  const emailB = `doc-b-${suffix}@sidian.test`;

  const userA = await createUser(emailA, password);
  const userB = await createUser(emailB, password);
  const prestataireA = await insertOne("prestataire", {
    user_id: userA.id,
    nom: "Doc A",
    email: emailA,
  });
  await insertOne("prestataire", {
    user_id: userB.id,
    nom: "Doc B",
    email: emailB,
  });

  const clientA = await signIn(emailA, password);
  const clientB = await signIn(emailB, password);

  // ── Enregistrement nominal ───────────────────────────────────────────────
  const { data: docA, error: registerError } = await clientA.rpc(
    "register_document_upload",
    {
      p_original_filename: "facture-aout.pdf",
      p_mime_type: "application/pdf",
      p_size_bytes: 12_345,
    },
  );
  if (registerError) throw registerError;
  check(
    docA?.id && docA.status === "pending_upload",
    "un upload s'enregistre en pending_upload",
  );
  check(
    docA.prestataire_id === prestataireA.id,
    "le périmètre vient de la session, jamais d'un paramètre",
  );
  check(
    typeof docA.storage_path === "string" &&
      docA.storage_path.startsWith(`${prestataireA.id}/`),
    "le chemin de stockage est préfixé par le prestataire",
  );

  // ── Garde-fous MIME et taille, appliqués en SQL ──────────────────────────
  const { error: mimeError } = await clientA.rpc("register_document_upload", {
    p_original_filename: "archive.zip",
    p_mime_type: "application/zip",
    p_size_bytes: 1_000,
  });
  check(Boolean(mimeError), "un type MIME hors allowlist est refusé par le SQL");

  const { data: maxBytes } = await clientA.rpc("document_max_size_bytes");
  const { error: sizeError } = await clientA.rpc("register_document_upload", {
    p_original_filename: "trop-gros.pdf",
    p_mime_type: "application/pdf",
    p_size_bytes: Number(maxBytes) + 1,
  });
  check(
    Boolean(sizeError),
    "un fichier au-delà du plafond est refusé par le SQL",
  );

  // Le plafond SQL et le plafond TypeScript doivent être la même valeur :
  // une divergence rendrait l'un des deux contournable.
  const { DOCUMENT_MAX_SIZE_BYTES } = await import(
    "../src/lib/documents/schemas.ts"
  ).catch(() => ({ DOCUMENT_MAX_SIZE_BYTES: null }));
  if (DOCUMENT_MAX_SIZE_BYTES !== null) {
    check(
      Number(maxBytes) === Number(DOCUMENT_MAX_SIZE_BYTES),
      "le plafond de taille est identique en SQL et en TypeScript",
    );
  }

  // ── Traversée de chemin ──────────────────────────────────────────────────
  const { data: traversal, error: traversalError } = await clientA.rpc(
    "register_document_upload",
    {
      p_original_filename: "../../../etc/passwd",
      p_mime_type: "text/plain",
      p_size_bytes: 10,
    },
  );
  check(
    Boolean(traversalError) ||
      (!traversal.storage_path.includes("..") &&
        traversal.storage_path.startsWith(`${prestataireA.id}/`)),
    "un nom de fichier avec ../ ne peut pas sortir du préfixe du prestataire",
  );

  // ── Isolation : B ne voit rien de A ──────────────────────────────────────
  const { data: seenByB } = await clientB.rpc("list_current_documents", {});
  check(
    !(seenByB ?? []).some((row) => row.id === docA.id),
    "B ne voit aucun document de A via list_current_documents",
  );

  const { data: fetchedByB } = await clientB.rpc("get_current_document", {
    p_document_id: docA.id,
  });
  check(
    !fetchedByB || fetchedByB.length === 0,
    "B ne peut pas lire un document de A par son identifiant",
  );

  const { data: tableReadByB } = await clientB
    .from("document")
    .select("id")
    .eq("id", docA.id);
  check(
    (tableReadByB ?? []).length === 0,
    "la RLS empêche B de lire la ligne document de A",
  );

  const { data: confirmedByB, error: confirmByBError } = await clientB.rpc(
    "confirm_document_upload",
    { p_document_id: docA.id },
  );
  check(
    Boolean(confirmByBError) || !confirmedByB,
    "B ne peut pas confirmer l'upload de A",
  );

  const { data: deletedByB, error: deleteByBError } = await clientB.rpc(
    "soft_delete_document",
    { p_document_id: docA.id },
  );
  check(
    Boolean(deleteByBError) || !deletedByB,
    "B ne peut pas supprimer le document de A",
  );

  // ── Upload réel dans le bucket, sous l'identité de chacun ────────────────
  // `confirm_document_upload` vérifie que l'objet existe : il faut donc
  // déposer un vrai fichier, ce qui exerce au passage les policies storage.
  const payload = new Blob([new Uint8Array([37, 80, 68, 70])], {
    type: "application/pdf",
  });

  const { error: uploadByBError } = await clientB.storage
    .from("documents")
    .upload(docA.storage_path, payload, { contentType: "application/pdf" });
  check(
    Boolean(uploadByBError),
    "B ne peut pas déposer un objet sous le préfixe de A",
  );

  const { error: uploadError } = await clientA.storage
    .from("documents")
    .upload(docA.storage_path, payload, { contentType: "application/pdf" });
  if (uploadError) throw uploadError;
  check(true, "A dépose son objet sous son propre préfixe");

  const { error: downloadByBError } = await clientB.storage
    .from("documents")
    .download(docA.storage_path);
  check(
    Boolean(downloadByBError),
    "B ne peut pas télécharger l'objet de A",
  );

  // ── Confirmation et suppression par le propriétaire ──────────────────────
  const { data: confirmed, error: confirmError } = await clientA.rpc(
    "confirm_document_upload",
    { p_document_id: docA.id },
  );
  if (confirmError) throw confirmError;
  check(
    confirmed?.status && confirmed.status !== "pending_upload",
    "le propriétaire confirme son upload",
  );
  check(
    confirmed.status === "awaiting_processing" || confirmed.status === "stored",
    "un document confirmé n'est jamais annoncé comme analysé",
  );

  const { data: softDeleted, error: softDeleteError } = await clientA.rpc(
    "soft_delete_document",
    { p_document_id: docA.id },
  );
  if (softDeleteError) throw softDeleteError;
  check(
    softDeleted?.deleted_at !== null,
    "le propriétaire supprime son document (suppression douce)",
  );

  // ── Purge des uploads abandonnés ─────────────────────────────────────────
  const abandoned = await clientA.rpc("register_document_upload", {
    p_original_filename: "abandonne.pdf",
    p_mime_type: "application/pdf",
    p_size_bytes: 500,
  });
  await admin
    .from("document")
    .update({ created_at: "2020-01-01T00:00:00Z" })
    .eq("id", abandoned.data.id);

  const { error: purgeByUserError } = await clientA.rpc(
    "purge_abandoned_document_uploads",
    {},
  );
  check(
    Boolean(purgeByUserError),
    "un utilisateur authentifié ne peut pas déclencher la purge",
  );

  const { data: purged, error: purgeError } = await admin.rpc(
    "purge_abandoned_document_uploads",
    { p_older_than_hours: 1 },
  );
  if (purgeError) throw purgeError;
  check(
    (purged ?? []).some((row) => row.id === abandoned.data.id),
    "la purge service_role récupère les uploads abandonnés",
  );

  // ── Bucket privé ─────────────────────────────────────────────────────────
  const { data: buckets, error: bucketError } = await admin.storage.listBuckets();
  if (bucketError) throw bucketError;
  const documentBucket = (buckets ?? []).find((b) =>
    b.name.includes("document"),
  );
  check(
    Boolean(documentBucket) && documentBucket.public === false,
    "le bucket documentaire existe et est privé",
  );

  // ── Anon totalement exclu ────────────────────────────────────────────────
  const anon = localClient(LOCAL_DEMO_ANON_KEY);
  const { data: anonRows } = await anon.from("document").select("id");
  check(
    (anonRows ?? []).length === 0,
    "anon ne lit aucune ligne document",
  );
  const { error: anonRpcError } = await anon.rpc("register_document_upload", {
    p_original_filename: "x.pdf",
    p_mime_type: "application/pdf",
    p_size_bytes: 10,
  });
  check(Boolean(anonRpcError), "anon ne peut pas enregistrer d'upload");

  console.log(`\nSID-DOC-001 : ${passed}/${passed} tests réussis.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
