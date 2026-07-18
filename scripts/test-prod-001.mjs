#!/usr/bin/env node
/**
 * SID-PROD-001 — clients + paiements à recevoir.
 * Utilise les modules cœur applicatifs (pas de duplication métier).
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

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
import {
  archiveClientPayeur,
  createClientPayeur,
  listActiveClientPayeurs,
  updateClientPayeur,
} from "../src/lib/clients/client-payeur-core.ts";
import {
  archiveCreance,
  createCreanceDraft,
  listActiveCreances,
  updateCreanceDraft,
} from "../src/lib/creances/creance-core.ts";
import {
  clientPayeurSchema,
  creanceCreateSchema,
  creanceDraftSchema,
  eurosToCentsExact,
  uuidSchema,
  canonicalizeEmailInput,
  isSidianEmail,
  SIDIAN_EMAIL_INVALID_EXAMPLES,
  SIDIAN_EMAIL_INVALID_LENGTH_255,
  SIDIAN_EMAIL_VALID_EXAMPLES,
} from "../src/lib/clients/schemas.ts";
import { createCreationKeyMachine } from "../src/lib/clients/creation-key.ts";
import pg from "pg";

const localConfig = assertLocalTestConfig();
const SUPABASE_URL = localConfig.url;
const SUPABASE_ANON = LOCAL_DEMO_ANON_KEY;
const SUPABASE_SERVICE = LOCAL_DEMO_SERVICE_ROLE_KEY;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function createLocalClient(url, key, options = {}) {
  return createClient(url, key, withLocalOnlyFetch(options));
}

const admin = createLocalClient(SUPABASE_URL, SUPABASE_SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const results = [];

function pass(name) {
  results.push({ name, ok: true });
  console.log(`✓ ${name}`);
}

function fail(name, error) {
  const message = error instanceof Error ? error.message : String(error);
  results.push({ name, ok: false, message });
  console.error(`✗ ${name}: ${message}`);
}

async function runTest(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}

async function createConfirmedUser(email, password) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { agency_name: "Agence Prod" },
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  return data.user;
}

async function signInAs(email, password) {
  const client = createLocalClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw error ?? new Error("signIn failed");
  return client;
}

async function ensurePrestataire(client, nom) {
  const { data, error } = await client.rpc("ensure_prestataire_for_current_user", {
    p_nom: nom,
  });
  if (error || !data) throw error ?? new Error("ensure prestataire failed");
  return data;
}

function assertAclSelectOnly(data) {
  const expected = {
    select: true,
    insert: false,
    update: false,
    delete: false,
    truncate: false,
    references: false,
    trigger: false,
    maintain: false,
    anon_select: false,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (data[key] !== value) {
      throw new Error(`ACL ${key}=${data[key]} (attendu ${value})`);
    }
  }
  if (!Array.isArray(data.mutation_policies) || data.mutation_policies.length > 0) {
    throw new Error(`policies mutation: ${JSON.stringify(data.mutation_policies)}`);
  }
  if (data.column_mutation_grants === true) {
    throw new Error("column_mutation_grants présents");
  }
}

const suffix = Date.now();
const password = "Motdepasse1";

// --- ACL / grants ---

await runTest("SID-PROD-001 ACL client_payeur = SELECT uniquement (8 priv)", async () => {
  const { data, error } = await admin.rpc("sidian_table_authenticated_privileges", {
    p_table: "client_payeur",
  });
  if (error) throw error;
  assertAclSelectOnly(data);
});

await runTest("SID-PROD-001 ACL creance = SELECT uniquement (8 priv)", async () => {
  const { data, error } = await admin.rpc("sidian_table_authenticated_privileges", {
    p_table: "creance",
  });
  if (error) throw error;
  assertAclSelectOnly(data);
});

await runTest("SID-PROD-001 anon sans accès métier", async () => {
  const anon = createLocalClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  for (const table of ["client_payeur", "creance"]) {
    const { data, error } = await anon.from(table).select("id").limit(1);
    if (!error && (data ?? []).length > 0) {
      throw new Error(`anon lit ${table}`);
    }
  }
  const { error: rpcError } = await anon.rpc("create_current_client_payeur", {
    p_nom: "X",
    p_email: "x@example.com",
    p_creation_key: randomUUID(),
  });
  if (!rpcError) throw new Error("RPC anon acceptée");
});

await runTest("SID-PROD-001 INSERT PostgREST client_payeur refusé", async () => {
  const email = `prod-ins-${suffix}@example.com`;
  await createConfirmedUser(email, password);
  const client = await signInAs(email, password);
  await ensurePrestataire(client, "Agence");
  const { error } = await client.from("client_payeur").insert({
    prestataire_id: "00000000-0000-0000-0000-000000000001",
    nom: "Hack",
    email: "hack@evil.example",
    creation_key: randomUUID(),
  });
  if (!error) throw new Error("INSERT direct autorisé");
});

await runTest("SID-PROD-001 INSERT PostgREST creance refusé", async () => {
  const email = `prod-ins-cr-${suffix}@example.com`;
  await createConfirmedUser(email, password);
  const client = await signInAs(email, password);
  await ensurePrestataire(client, "Agence");
  const { error } = await client.from("creance").insert({
    prestataire_id: "00000000-0000-0000-0000-000000000001",
    client_payeur_id: "00000000-0000-0000-0000-000000000002",
    montant: 100,
    devise: "EUR",
    origine: "import_manuel",
    date_echeance: "2026-09-01",
    etat: "BROUILLON",
    creation_key: randomUUID(),
  });
  if (!error) throw new Error("INSERT creance direct autorisé");
});

await runTest("SID-PROD-001 helper require_current_prestataire_id refusé JWT", async () => {
  const email = `prod-helper-${suffix}@example.com`;
  await createConfirmedUser(email, password);
  const client = await signInAs(email, password);
  await ensurePrestataire(client, "Agence");
  const { error } = await client.rpc("require_current_prestataire_id");
  if (!error) throw new Error("helper callable authenticated");
});

// --- Clients cœur ---

await runTest("SID-PROD-001 module cœur crée un client canonicalisé", async () => {
  const email = `prod-cli-${suffix}@example.com`;
  await createConfirmedUser(email, password);
  const client = await signInAs(email, password);
  await ensurePrestataire(client, "Agence Client");

  const created = await createClientPayeur(client, {
    nom: "  Marie   Dupont  ",
    email: "  Marie.Dupont@Example.COM ",
    creationKey: randomUUID(),
  });

  if (created.nom !== "Marie Dupont") throw new Error(`nom=${created.nom}`);
  if (created.email !== "marie.dupont@example.com") {
    throw new Error(`email=${created.email}`);
  }
  if (created.archived_at) throw new Error("archived à la création");
  if (!created.creation_key) throw new Error("creation_key manquante");
});

await runTest("SID-PROD-001 update client limité à nom/email", async () => {
  const email = `prod-upd-${suffix}@example.com`;
  await createConfirmedUser(email, password);
  const client = await signInAs(email, password);
  await ensurePrestataire(client, "Agence");
  const created = await createClientPayeur(client, {
    nom: "Avant",
    email: "avant@example.com",
    creationKey: randomUUID(),
  });

  const updated = await updateClientPayeur(client, {
    id: created.id,
    nom: "Après",
    email: "APRES@Example.com",
  });

  if (updated.nom !== "Après") throw new Error("nom non mis à jour");
  if (updated.email !== "apres@example.com") throw new Error("email non canonique");

  const { error } = await client
    .from("client_payeur")
    .update({ historique_paiements_reguliers: 99 })
    .eq("id", created.id);
  if (!error) throw new Error("UPDATE historique PostgREST autorisé");
});

await runTest("SID-PROD-001 isolation clients A/B", async () => {
  const emailA = `prod-a-${suffix}@example.com`;
  const emailB = `prod-b-${suffix}@example.com`;
  await createConfirmedUser(emailA, password);
  await createConfirmedUser(emailB, password);
  const clientA = await signInAs(emailA, password);
  const clientB = await signInAs(emailB, password);
  await ensurePrestataire(clientA, "A");
  await ensurePrestataire(clientB, "B");

  const rowA = await createClientPayeur(clientA, {
    nom: "Client A",
    email: "ca@example.com",
    creationKey: randomUUID(),
  });
  await createClientPayeur(clientB, {
    nom: "Client B",
    email: "cb@example.com",
    creationKey: randomUUID(),
  });

  const listA = await listActiveClientPayeurs(clientA);
  if (listA.some((row) => row.email === "cb@example.com")) {
    throw new Error("fuite client B");
  }

  let updateBlocked = false;
  try {
    await updateClientPayeur(clientB, {
      id: rowA.id,
      nom: "piraté",
      email: "pirate@example.com",
    });
  } catch {
    updateBlocked = true;
  }
  if (!updateBlocked) throw new Error("B a modifié A");
});

// --- Archivage client (anomalie 001) ---

await runTest("SID-PROD-001 archive client sans créance autorisé", async () => {
  const email = `prod-arch-ok-${suffix}@example.com`;
  await createConfirmedUser(email, password);
  const client = await signInAs(email, password);
  await ensurePrestataire(client, "Agence");
  const created = await createClientPayeur(client, {
    nom: "Libre",
    email: "libre@example.com",
    creationKey: randomUUID(),
  });
  const archived = await archiveClientPayeur(client, created.id);
  if (!archived.archived_at) throw new Error("archived_at manquant");
});

await runTest("SID-PROD-001 archive client avec brouillon refusé", async () => {
  const email = `prod-arch-br-${suffix}@example.com`;
  await createConfirmedUser(email, password);
  const client = await signInAs(email, password);
  await ensurePrestataire(client, "Agence");
  const payeur = await createClientPayeur(client, {
    nom: "Avec draft",
    email: "draft-cli@example.com",
    creationKey: randomUUID(),
  });
  await createCreanceDraft(client, {
    clientPayeurId: payeur.id,
    montantCents: 1000,
    dateEcheance: "2026-09-01",
    creationKey: randomUUID(),
  });

  let blocked = false;
  try {
    await archiveClientPayeur(client, payeur.id);
  } catch (error) {
    blocked = error instanceof Error && error.message === "CLIENT_HAS_ACTIVE_CREANCES";
  }
  if (!blocked) throw new Error("archivage avec brouillon accepté");
});

await runTest("SID-PROD-001 archive client avec créance non brouillon refusé", async () => {
  const email = `prod-arch-ouv-${suffix}@example.com`;
  await createConfirmedUser(email, password);
  const client = await signInAs(email, password);
  await ensurePrestataire(client, "Agence");
  const payeur = await createClientPayeur(client, {
    nom: "Ouverte",
    email: "ouverte@example.com",
    creationKey: randomUUID(),
  });
  const creance = await createCreanceDraft(client, {
    clientPayeurId: payeur.id,
    montantCents: 1000,
    dateEcheance: "2026-09-01",
    creationKey: randomUUID(),
  });
  await admin.from("creance").update({ etat: "OUVERTE" }).eq("id", creance.id);

  let blocked = false;
  try {
    await archiveClientPayeur(client, payeur.id);
  } catch (error) {
    blocked = error instanceof Error && error.message === "CLIENT_HAS_ACTIVE_CREANCES";
  }
  if (!blocked) throw new Error("archivage avec OUVERTE accepté");
});

await runTest("SID-PROD-001 archive client si toutes créances archivées", async () => {
  const email = `prod-arch-all-${suffix}@example.com`;
  await createConfirmedUser(email, password);
  const client = await signInAs(email, password);
  await ensurePrestataire(client, "Agence");
  const payeur = await createClientPayeur(client, {
    nom: "Tout archivé",
    email: "allarch@example.com",
    creationKey: randomUUID(),
  });
  const creance = await createCreanceDraft(client, {
    clientPayeurId: payeur.id,
    montantCents: 1000,
    dateEcheance: "2026-09-01",
    creationKey: randomUUID(),
  });
  await archiveCreance(client, creance.id);
  const archived = await archiveClientPayeur(client, payeur.id);
  if (!archived.archived_at) throw new Error("client non archivé");
});

await runTest("SID-PROD-001 archive client autre tenant refusé", async () => {
  const emailA = `prod-arch-ta-${suffix}@example.com`;
  const emailB = `prod-arch-tb-${suffix}@example.com`;
  await createConfirmedUser(emailA, password);
  await createConfirmedUser(emailB, password);
  const clientA = await signInAs(emailA, password);
  const clientB = await signInAs(emailB, password);
  await ensurePrestataire(clientA, "A");
  await ensurePrestataire(clientB, "B");
  const payeurA = await createClientPayeur(clientA, {
    nom: "A",
    email: "a-arch@example.com",
    creationKey: randomUUID(),
  });

  let blocked = false;
  try {
    await archiveClientPayeur(clientB, payeurA.id);
  } catch {
    blocked = true;
  }
  if (!blocked) throw new Error("archive cross-tenant");
});

await runTest("SID-PROD-001 archive client répété idempotent", async () => {
  const email = `prod-arch-idem-${suffix}@example.com`;
  await createConfirmedUser(email, password);
  const client = await signInAs(email, password);
  await ensurePrestataire(client, "Agence");
  const created = await createClientPayeur(client, {
    nom: "Idem",
    email: "idem-arch@example.com",
    creationKey: randomUUID(),
  });
  const first = await archiveClientPayeur(client, created.id);
  const second = await archiveClientPayeur(client, created.id);
  if (!first.archived_at || !second.archived_at) throw new Error("archived_at");
  if (first.archived_at !== second.archived_at) {
    throw new Error("archived_at modifié au replay");
  }
});

await runTest("SID-PROD-001 archive créance répétée idempotente", async () => {
  const email = `prod-cr-arch-idem-${suffix}@example.com`;
  await createConfirmedUser(email, password);
  const client = await signInAs(email, password);
  await ensurePrestataire(client, "Agence");
  const payeur = await createClientPayeur(client, {
    nom: "P",
    email: "p-idem@example.com",
    creationKey: randomUUID(),
  });
  const creance = await createCreanceDraft(client, {
    clientPayeurId: payeur.id,
    montantCents: 1000,
    dateEcheance: "2026-09-01",
    creationKey: randomUUID(),
  });
  const first = await archiveCreance(client, creance.id);
  const second = await archiveCreance(client, creance.id);
  if (first.archived_at !== second.archived_at) {
    throw new Error("archived_at créance modifié");
  }
});

// --- Email SQL / Zod alignés ---

await runTest("SID-PROD-001 matrice email Zod ↔ SQL", async () => {
  const email = `prod-em-matrix-${suffix}@example.com`;
  await createConfirmedUser(email, password);
  const client = await signInAs(email, password);
  await ensurePrestataire(client, "Agence");

  for (const bad of SIDIAN_EMAIL_INVALID_EXAMPLES) {
    const canonical = canonicalizeEmailInput(bad);
    if (isSidianEmail(canonical)) {
      throw new Error(`Zod/helper accepte invalide: ${JSON.stringify(bad)}`);
    }
    if (
      clientPayeurSchema.safeParse({
        nom: "X",
        email: bad,
        creationKey: randomUUID(),
      }).success
    ) {
      throw new Error(`Zod schema accepte: ${JSON.stringify(bad)}`);
    }
    const { error } = await client.rpc("create_current_client_payeur", {
      p_nom: "Bad",
      p_email: bad,
      p_creation_key: randomUUID(),
    });
    if (!error) throw new Error(`SQL accepte: ${JSON.stringify(bad)}`);
    if (/position\(|~|regex|check|label/i.test(error.message)) {
      throw new Error(`détail SQL exposé: ${error.message}`);
    }
  }

  if (SIDIAN_EMAIL_INVALID_LENGTH_255.length !== 255) {
    throw new Error(
      `email longueur isolée: expected 255, got ${SIDIAN_EMAIL_INVALID_LENGTH_255.length}`,
    );
  }
  if (!SIDIAN_EMAIL_INVALID_EXAMPLES.includes(SIDIAN_EMAIL_INVALID_LENGTH_255)) {
    throw new Error("email 255 absent de la matrice invalide");
  }
  if (!SIDIAN_EMAIL_INVALID_EXAMPLES.includes("a@example.c")) {
    throw new Error("a@example.c absent de la matrice invalide");
  }
  // Jumeau structurel à 254 caractères — doit passer (seul le >254 isole le cas 255)
  const structuralTwin254 = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(57)}.com`;
  if (structuralTwin254.length !== 254) {
    throw new Error(`jumeau 254: got ${structuralTwin254.length}`);
  }
  if (!isSidianEmail(structuralTwin254)) {
    throw new Error("jumeau 254 refusé — cas 255 non isolé à la longueur");
  }
  if (
    !clientPayeurSchema.safeParse({
      nom: "Twin",
      email: structuralTwin254,
      creationKey: randomUUID(),
    }).success
  ) {
    throw new Error("Zod refuse le jumeau 254");
  }

  for (const raw of SIDIAN_EMAIL_VALID_EXAMPLES) {
    const expected = canonicalizeEmailInput(raw);
    if (!isSidianEmail(expected)) {
      throw new Error(`helper refuse valide: ${raw}`);
    }
    const zod = clientPayeurSchema.safeParse({
      nom: "OK",
      email: raw,
      creationKey: randomUUID(),
    });
    if (!zod.success) throw new Error(`Zod refuse valide: ${raw}`);
    if (zod.data.email !== expected) {
      throw new Error(`Zod canonique=${zod.data.email}`);
    }

    const { data, error } = await client.rpc("create_current_client_payeur", {
      p_nom: "OK",
      p_email: raw,
      p_creation_key: randomUUID(),
    });
    if (error || !data) throw error ?? new Error(`SQL refuse valide: ${raw}`);
    if (data.email !== expected) {
      throw new Error(`SQL stocké=${data.email} attendu=${expected}`);
    }
  }
});

// --- Devise / montants Zod + SQL ---

await runTest("SID-PROD-001 Zod devise EUR uniquement", async () => {
  const key = randomUUID();
  const base = {
    clientPayeurId: randomUUID(),
    creationKey: key,
    montantEuros: "10.00",
    dateEcheance: "2026-09-01",
    libelle: "",
    referenceExterne: "",
  };
  if (!creanceCreateSchema.safeParse({ ...base, devise: "EUR" }).success) {
    throw new Error("EUR rejeté");
  }
  for (const bad of ["eur", "USD", "ZZZ", ""]) {
    if (creanceCreateSchema.safeParse({ ...base, devise: bad }).success) {
      throw new Error(`devise acceptée: ${bad}`);
    }
  }
});

await runTest("SID-PROD-001 SQL devise eur/USD/ZZZ refusées JWT", async () => {
  const email = `prod-dev-${suffix}@example.com`;
  await createConfirmedUser(email, password);
  const client = await signInAs(email, password);
  await ensurePrestataire(client, "Agence");
  const payeur = await createClientPayeur(client, {
    nom: "D",
    email: "dev@example.com",
    creationKey: randomUUID(),
  });

  for (const bad of ["eur", "USD", "ZZZ", ""]) {
    const { error } = await client.rpc("create_current_creance", {
      p_client_payeur_id: payeur.id,
      p_montant: 100,
      p_date_echeance: "2026-09-01",
      p_creation_key: randomUUID(),
      p_devise: bad,
    });
    if (!error) throw new Error(`devise SQL acceptée: ${bad}`);
  }
});

await runTest("SID-PROD-001 conversion montants exacte + bornes Zod", async () => {
  const cases = [
    ["0", false],
    ["0.001", false],
    ["0.01", true, 1],
    ["1", true, 100],
    ["1.20", true, 120],
    ["999999.99", true, 99999999],
    ["1000000.00", true, 100000000],
    ["1000000.01", false],
    ["1e2", false],
    ["abc", false],
    ["9007199254740993.00", false],
  ];

  for (const [raw, ok, cents] of cases) {
    let exactOk = true;
    let value;
    try {
      value = eurosToCentsExact(
        String(raw).includes(",") ? String(raw) : String(raw).trim().replace(",", "."),
      );
    } catch {
      exactOk = false;
    }

    const zod = creanceDraftSchema.safeParse({
      clientPayeurId: randomUUID(),
      montantEuros: raw,
      devise: "EUR",
      dateEcheance: "2026-09-01",
      libelle: "",
      referenceExterne: "",
    });

    if (ok) {
      if (!exactOk || value !== cents) {
        throw new Error(`attendu ${raw} → ${cents}, got ${value}`);
      }
      if (!zod.success) throw new Error(`Zod refuse ${raw}`);
    } else if (exactOk || zod.success) {
      throw new Error(`devrait refuser ${raw}`);
    }
  }
});

await runTest("SID-PROD-001 montants SQL bornes JWT", async () => {
  const email = `prod-mt-sql-${suffix}@example.com`;
  await createConfirmedUser(email, password);
  const client = await signInAs(email, password);
  await ensurePrestataire(client, "Agence");
  const payeur = await createClientPayeur(client, {
    nom: "M",
    email: "mt@example.com",
    creationKey: randomUUID(),
  });

  for (const bad of [0, -1, 100000001]) {
    const { error } = await client.rpc("create_current_creance", {
      p_client_payeur_id: payeur.id,
      p_montant: bad,
      p_date_echeance: "2026-09-01",
      p_creation_key: randomUUID(),
    });
    if (!error) throw new Error(`montant ${bad} accepté`);
  }

  const { data, error } = await client.rpc("create_current_creance", {
    p_client_payeur_id: payeur.id,
    p_montant: 1,
    p_date_echeance: "2026-09-01",
    p_creation_key: randomUUID(),
  });
  if (error || data?.montant !== 1) throw error ?? new Error("min 1 échoué");

  const { data: maxRow, error: maxErr } = await client.rpc("create_current_creance", {
    p_client_payeur_id: payeur.id,
    p_montant: 100000000,
    p_date_echeance: "2026-09-01",
    p_creation_key: randomUUID(),
  });
  if (maxErr || maxRow?.montant !== 100000000) {
    throw maxErr ?? new Error("max échoué");
  }
});

await runTest("SID-PROD-001 créance brouillon via module cœur", async () => {
  const email = `prod-cr-${suffix}@example.com`;
  await createConfirmedUser(email, password);
  const client = await signInAs(email, password);
  await ensurePrestataire(client, "Agence");
  const payeur = await createClientPayeur(client, {
    nom: "Payeur",
    email: "payeur@example.com",
    creationKey: randomUUID(),
  });

  const creance = await createCreanceDraft(client, {
    clientPayeurId: payeur.id,
    montantCents: 50000,
    dateEcheance: "2026-09-01",
    libelle: "  Presta EPICU  ",
    referenceExterne: " FAC-1 ",
    devise: "EUR",
    creationKey: randomUUID(),
  });

  if (creance.etat !== "BROUILLON") throw new Error(`etat=${creance.etat}`);
  if (creance.origine !== "import_manuel") throw new Error("origine");
  if (creance.montant !== 50000) throw new Error("montant");
  if (creance.devise !== "EUR") throw new Error("devise");
  if (creance.libelle !== "Presta EPICU") throw new Error("libelle");
  if (creance.reference_externe !== "FAC-1") throw new Error("reference");
});

await runTest("SID-PROD-001 update brouillon + refus hors brouillon", async () => {
  const email = `prod-draft-${suffix}@example.com`;
  await createConfirmedUser(email, password);
  const client = await signInAs(email, password);
  await ensurePrestataire(client, "Agence");
  const payeur = await createClientPayeur(client, {
    nom: "Payeur",
    email: "draft@example.com",
    creationKey: randomUUID(),
  });
  const other = await createClientPayeur(client, {
    nom: "Autre",
    email: "autre@example.com",
    creationKey: randomUUID(),
  });

  const creance = await createCreanceDraft(client, {
    clientPayeurId: payeur.id,
    montantCents: 1000,
    dateEcheance: "2026-10-01",
    libelle: "Draft",
    creationKey: randomUUID(),
  });

  const updated = await updateCreanceDraft(client, creance.id, {
    clientPayeurId: other.id,
    montantCents: 2500,
    dateEcheance: "2026-11-01",
    libelle: "Draft 2",
    referenceExterne: "R2",
    devise: "EUR",
  });

  if (updated.montant !== 2500) throw new Error("montant");
  if (updated.client_payeur_id !== other.id) throw new Error("client");
  if (updated.libelle !== "Draft 2") throw new Error("libelle");

  await admin.from("creance").update({ etat: "OUVERTE" }).eq("id", creance.id);

  let blocked = false;
  try {
    await updateCreanceDraft(client, creance.id, {
      clientPayeurId: other.id,
      montantCents: 3000,
      dateEcheance: "2026-12-01",
    });
  } catch {
    blocked = true;
  }
  if (!blocked) throw new Error("update hors brouillon accepté");
});

await runTest("SID-PROD-001 client autre tenant refusé create/update créance", async () => {
  const emailA = `prod-xt-a-${suffix}@example.com`;
  const emailB = `prod-xt-b-${suffix}@example.com`;
  await createConfirmedUser(emailA, password);
  await createConfirmedUser(emailB, password);
  const clientA = await signInAs(emailA, password);
  const clientB = await signInAs(emailB, password);
  await ensurePrestataire(clientA, "A");
  await ensurePrestataire(clientB, "B");
  const payeurA = await createClientPayeur(clientA, {
    nom: "A",
    email: "xta@example.com",
    creationKey: randomUUID(),
  });
  const payeurB = await createClientPayeur(clientB, {
    nom: "B",
    email: "xtb@example.com",
    creationKey: randomUUID(),
  });

  let createBlocked = false;
  try {
    await createCreanceDraft(clientA, {
      clientPayeurId: payeurB.id,
      montantCents: 1000,
      dateEcheance: "2026-09-01",
      creationKey: randomUUID(),
    });
  } catch {
    createBlocked = true;
  }
  if (!createBlocked) throw new Error("create cross-tenant");

  const creance = await createCreanceDraft(clientA, {
    clientPayeurId: payeurA.id,
    montantCents: 1000,
    dateEcheance: "2026-09-01",
    creationKey: randomUUID(),
  });

  let updateBlocked = false;
  try {
    await updateCreanceDraft(clientA, creance.id, {
      clientPayeurId: payeurB.id,
      montantCents: 1000,
      dateEcheance: "2026-09-01",
    });
  } catch {
    updateBlocked = true;
  }
  if (!updateBlocked) throw new Error("update cross-tenant client");
});

await runTest("SID-PROD-001 date calendaire invalide refusée", async () => {
  const email = `prod-date-${suffix}@example.com`;
  await createConfirmedUser(email, password);
  const client = await signInAs(email, password);
  await ensurePrestataire(client, "Agence");
  const payeur = await createClientPayeur(client, {
    nom: "D",
    email: "date@example.com",
    creationKey: randomUUID(),
  });

  if (
    creanceDraftSchema.safeParse({
      clientPayeurId: payeur.id,
      montantEuros: "10.00",
      devise: "EUR",
      dateEcheance: "2026-02-30",
      libelle: "",
      referenceExterne: "",
    }).success
  ) {
    throw new Error("Zod accepte 2026-02-30");
  }

  const { error } = await client.rpc("create_current_creance", {
    p_client_payeur_id: payeur.id,
    p_montant: 100,
    p_date_echeance: "1999-01-01",
    p_creation_key: randomUUID(),
  });
  if (!error) throw new Error("année 1999 acceptée");
});

await runTest("SID-PROD-001 UPDATE/DELETE PostgREST créance refusés", async () => {
  const email = `prod-pg-${suffix}@example.com`;
  await createConfirmedUser(email, password);
  const client = await signInAs(email, password);
  await ensurePrestataire(client, "Agence");
  const payeur = await createClientPayeur(client, {
    nom: "Payeur",
    email: "pg@example.com",
    creationKey: randomUUID(),
  });
  const creance = await createCreanceDraft(client, {
    clientPayeurId: payeur.id,
    montantCents: 1000,
    dateEcheance: "2026-08-01",
    creationKey: randomUUID(),
  });

  const { error: updError } = await client
    .from("creance")
    .update({ montant: 1, etat: "REGLEE" })
    .eq("id", creance.id);
  if (!updError) throw new Error("UPDATE PostgREST autorisé");

  const { error: delError } = await client
    .from("creance")
    .delete()
    .eq("id", creance.id);
  if (!delError) throw new Error("DELETE PostgREST autorisé");
});

await runTest("SID-PROD-001 isolation créances + archive", async () => {
  const emailA = `prod-cra-${suffix}@example.com`;
  const emailB = `prod-crb-${suffix}@example.com`;
  await createConfirmedUser(emailA, password);
  await createConfirmedUser(emailB, password);
  const clientA = await signInAs(emailA, password);
  const clientB = await signInAs(emailB, password);
  await ensurePrestataire(clientA, "A");
  await ensurePrestataire(clientB, "B");
  const payeurA = await createClientPayeur(clientA, {
    nom: "A",
    email: "a@example.com",
    creationKey: randomUUID(),
  });
  const payeurB = await createClientPayeur(clientB, {
    nom: "B",
    email: "b@example.com",
    creationKey: randomUUID(),
  });

  const creanceA = await createCreanceDraft(clientA, {
    clientPayeurId: payeurA.id,
    montantCents: 1000,
    dateEcheance: "2026-08-15",
    creationKey: randomUUID(),
  });
  await createCreanceDraft(clientB, {
    clientPayeurId: payeurB.id,
    montantCents: 2000,
    dateEcheance: "2026-08-16",
    creationKey: randomUUID(),
  });

  const listA = await listActiveCreances(clientA);
  if (listA.some((row) => row.client_payeur_id === payeurB.id)) {
    throw new Error("fuite créance B");
  }

  let blocked = false;
  try {
    await archiveCreance(clientB, creanceA.id);
  } catch {
    blocked = true;
  }
  if (!blocked) throw new Error("archive cross-tenant");

  const archived = await archiveCreance(clientA, creanceA.id);
  if (!archived.archived_at) throw new Error("archived_at");
});

// --- Idempotence ---

await runTest("SID-PROD-001 idempotence client séquentielle", async () => {
  const email = `prod-id-c-${suffix}@example.com`;
  await createConfirmedUser(email, password);
  const client = await signInAs(email, password);
  await ensurePrestataire(client, "Agence");
  const key = randomUUID();
  const first = await createClientPayeur(client, {
    nom: "Idem",
    email: "idem-c@example.com",
    creationKey: key,
  });
  const second = await createClientPayeur(client, {
    nom: "Idem",
    email: "idem-c@example.com",
    creationKey: key,
  });
  if (first.id !== second.id) throw new Error("ids distincts");
});

await runTest("SID-PROD-001 idempotence client concurrente", async () => {
  const email = `prod-id-cc-${suffix}@example.com`;
  await createConfirmedUser(email, password);
  const client = await signInAs(email, password);
  await ensurePrestataire(client, "Agence");
  const key = randomUUID();
  const payload = {
    nom: "Concurrent",
    email: "conc-c@example.com",
    creationKey: key,
  };
  const [a, b] = await Promise.all([
    createClientPayeur(client, payload),
    createClientPayeur(client, payload),
  ]);
  if (a.id !== b.id) throw new Error("deux lignes");
  const { count } = await admin
    .from("client_payeur")
    .select("id", { count: "exact", head: true })
    .eq("creation_key", key);
  if (count !== 1) throw new Error(`count=${count}`);
});

await runTest("SID-PROD-001 idempotence client payload contradictoire", async () => {
  const email = `prod-id-cf-${suffix}@example.com`;
  await createConfirmedUser(email, password);
  const client = await signInAs(email, password);
  await ensurePrestataire(client, "Agence");
  const key = randomUUID();
  await createClientPayeur(client, {
    nom: "Un",
    email: "un@example.com",
    creationKey: key,
  });
  let conflict = false;
  try {
    await createClientPayeur(client, {
      nom: "Deux",
      email: "deux@example.com",
      creationKey: key,
    });
  } catch (error) {
    conflict =
      error instanceof Error && error.message === "idempotency_payload_conflict";
  }
  if (!conflict) throw new Error("conflit non détecté");
});

await runTest("SID-PROD-001 idempotence créance séquentielle", async () => {
  const email = `prod-id-r-${suffix}@example.com`;
  await createConfirmedUser(email, password);
  const client = await signInAs(email, password);
  await ensurePrestataire(client, "Agence");
  const payeur = await createClientPayeur(client, {
    nom: "P",
    email: "idr@example.com",
    creationKey: randomUUID(),
  });
  const key = randomUUID();
  const payload = {
    clientPayeurId: payeur.id,
    montantCents: 2500,
    dateEcheance: "2026-09-01",
    libelle: "Same",
    creationKey: key,
  };
  const first = await createCreanceDraft(client, payload);
  const second = await createCreanceDraft(client, payload);
  if (first.id !== second.id) throw new Error("ids distincts");
});

await runTest("SID-PROD-001 idempotence créance concurrente", async () => {
  const email = `prod-id-rc-${suffix}@example.com`;
  await createConfirmedUser(email, password);
  const client = await signInAs(email, password);
  await ensurePrestataire(client, "Agence");
  const payeur = await createClientPayeur(client, {
    nom: "P",
    email: "idrc@example.com",
    creationKey: randomUUID(),
  });
  const key = randomUUID();
  const payload = {
    clientPayeurId: payeur.id,
    montantCents: 2500,
    dateEcheance: "2026-09-01",
    creationKey: key,
  };
  const [a, b] = await Promise.all([
    createCreanceDraft(client, payload),
    createCreanceDraft(client, payload),
  ]);
  if (a.id !== b.id) throw new Error("deux créances");
});

await runTest("SID-PROD-001 idempotence créance payload contradictoire", async () => {
  const email = `prod-id-rf-${suffix}@example.com`;
  await createConfirmedUser(email, password);
  const client = await signInAs(email, password);
  await ensurePrestataire(client, "Agence");
  const payeur = await createClientPayeur(client, {
    nom: "P",
    email: "idrf@example.com",
    creationKey: randomUUID(),
  });
  const key = randomUUID();
  await createCreanceDraft(client, {
    clientPayeurId: payeur.id,
    montantCents: 1000,
    dateEcheance: "2026-09-01",
    creationKey: key,
  });
  let conflict = false;
  try {
    await createCreanceDraft(client, {
      clientPayeurId: payeur.id,
      montantCents: 2000,
      dateEcheance: "2026-09-01",
      creationKey: key,
    });
  } catch (error) {
    conflict =
      error instanceof Error && error.message === "idempotency_payload_conflict";
  }
  if (!conflict) throw new Error("conflit créance non détecté");
});

await runTest("SID-PROD-001 isolation creation_key entre prestataires", async () => {
  const emailA = `prod-ik-a-${suffix}@example.com`;
  const emailB = `prod-ik-b-${suffix}@example.com`;
  await createConfirmedUser(emailA, password);
  await createConfirmedUser(emailB, password);
  const clientA = await signInAs(emailA, password);
  const clientB = await signInAs(emailB, password);
  await ensurePrestataire(clientA, "A");
  await ensurePrestataire(clientB, "B");
  const sharedKey = randomUUID();
  const a = await createClientPayeur(clientA, {
    nom: "A",
    email: "ika@example.com",
    creationKey: sharedKey,
  });
  const b = await createClientPayeur(clientB, {
    nom: "B",
    email: "ikb@example.com",
    creationKey: sharedKey,
  });
  if (a.id === b.id) throw new Error("même ligne cross-tenant");
});

// --- UUID actions / Zod ---

await runTest("SID-PROD-001 UUID invalides rejetés Zod", async () => {
  if (uuidSchema.safeParse("not-a-uuid").success) {
    throw new Error("uuid invalide accepté");
  }
  if (
    clientPayeurSchema.safeParse({
      nom: "X",
      email: "x@example.com",
      creationKey: "bad",
    }).success
  ) {
    throw new Error("creationKey invalide acceptée");
  }
});

// --- UI structurelle ---

await runTest("SID-PROD-001 UI sans réaffectation silencieuse", async () => {
  const source = readFileSync(
    join(root, "src/components/app/creance-forms.tsx"),
    "utf8",
  );
  if (source.includes("clients[0]")) {
    throw new Error("clients[0] encore présent");
  }
  if (!source.includes("paiement-client-bloque")) {
    throw new Error("état bloqué absent");
  }
  if (!source.includes("Sélectionnez un client")) {
    throw new Error("placeholder create absent");
  }
});

await runTest("SID-PROD-001 vocabulaire UI sans créance visible", async () => {
  const files = [
    "src/app/app/page.tsx",
    "src/app/app/paiements-a-recevoir/page.tsx",
    "src/components/app/creance-forms.tsx",
    "src/components/app/client-forms.tsx",
  ];
  for (const rel of files) {
    const source = readFileSync(join(root, rel), "utf8");
    // Chaînes littérales / JSX texte destinées à l'utilisateur
    const literals = [
      ...source.matchAll(/["'`]([^"'`]*?)["'`]/g),
      ...source.matchAll(/>\s*([^<{]+?)\s*</g),
    ].map((m) => m[1]);
    for (const text of literals) {
      if (/créance|créances|Créance|Créances/i.test(text)) {
        throw new Error(`vocabulaire créance dans ${rel}: ${text.trim()}`);
      }
    }
  }
});

await runTest("SID-PROD-001 IDs DOM uniques via useId / préfixe métier", async () => {
  for (const rel of [
    "src/components/app/client-forms.tsx",
    "src/components/app/creance-forms.tsx",
  ]) {
    const source = readFileSync(join(root, rel), "utf8");
    if (!source.includes("useId(")) {
      throw new Error(`useId absent dans ${rel}`);
    }
    if (/id=\"(nom|email|clientPayeurId|montantEuros)\"/.test(source)) {
      throw new Error(`id fixe partagé dans ${rel}`);
    }
  }
});

async function assertNoArchivedClientWithActiveCreance(clientPayeurId) {
  const { data: clientRow, error: clientError } = await admin
    .from("client_payeur")
    .select("archived_at")
    .eq("id", clientPayeurId)
    .single();
  if (clientError) throw clientError;
  if (!clientRow?.archived_at) return;

  const { count, error } = await admin
    .from("creance")
    .select("id", { count: "exact", head: true })
    .eq("client_payeur_id", clientPayeurId)
    .is("archived_at", null);
  if (error) throw error;
  if ((count ?? 0) > 0) {
    throw new Error("invariant violé: client archivé + créance active");
  }
}

const DB_URL = resolveLocalPostgresUrl();

async function openPg() {
  const client = createLocalPgClient(DB_URL, { Client: pg.Client });
  await client.connect();
  return client;
}

async function beginAuthed(pgClient, userId) {
  await pgClient.query("begin");
  await pgClient.query("select set_config('request.jwt.claim.sub', $1, true)", [
    userId,
  ]);
  await pgClient.query(
    "select set_config('request.jwt.claim.role', 'authenticated', true)",
  );
}

async function lockClientRow(pgClient, clientPayeurId) {
  const { rows } = await pgClient.query(
    `select id from public.client_payeur where id = $1 for update`,
    [clientPayeurId],
  );
  if (rows.length !== 1) throw new Error("lock client: ligne absente");
}

async function waitUntilBlocked(observer, targetPid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await observer.query(
      `select wait_event_type, state
       from pg_stat_activity
       where pid = $1`,
      [targetPid],
    );
    const wet = rows[0]?.wait_event_type;
    if (wet === "Lock") return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timeout: pid ${targetPid} non bloqué sur un verrou`);
}

/**
 * Course déterministe create ↔ archive via verrou externe sur client_payeur
 * (même ligne que les RPC FOR UPDATE) — aucun helper sidian_test_* .
 */
async function runCreateArchiveRace(order) {
  const email = `prod-race-${order}-${suffix}@example.com`;
  const user = await createConfirmedUser(email, password);
  const client = await signInAs(email, password);
  await ensurePrestataire(client, "Agence");
  const payeur = await createClientPayeur(client, {
    nom: "Race",
    email: `race-${order}@example.com`,
    creationKey: randomUUID(),
  });

  const holder = await openPg();
  const contender = await openPg();
  const observer = await openPg();
  try {
    await beginAuthed(holder, user.id);
    await lockClientRow(holder, payeur.id);

    if (order === "create_first") {
      const archivePromise = (async () => {
        await beginAuthed(contender, user.id);
        try {
          await contender.query(
            `select id from public.archive_current_client_payeur($1)`,
            [payeur.id],
          );
          await contender.query("commit");
          return { ok: true };
        } catch (error) {
          await contender.query("rollback").catch(() => {});
          return { ok: false, error };
        }
      })();

      // Laisser démarrer la requête bloquante
      await new Promise((r) => setTimeout(r, 50));
      await waitUntilBlocked(observer, contender.processID);

      const { rows } = await holder.query(
        `select id, client_payeur_id from public.create_current_creance(
          $1, $2, $3::date, $4::uuid, null, null, 'EUR'
        )`,
        [payeur.id, 1500, "2026-09-01", randomUUID()],
      );
      if (!rows[0]?.id) throw new Error("création non réussie");
      await holder.query("commit");

      const archiveResult = await archivePromise;
      if (archiveResult.ok) throw new Error("archivage aurait dû échouer");
      const msg = String(archiveResult.error?.message ?? "");
      if (!msg.includes("CLIENT_HAS_ACTIVE_CREANCES")) {
        throw new Error(`archivage: ${msg}`);
      }

      const { data: clientRow } = await admin
        .from("client_payeur")
        .select("archived_at")
        .eq("id", payeur.id)
        .single();
      if (clientRow?.archived_at) {
        throw new Error("client archivé malgré créance active");
      }
    } else {
      const createPromise = (async () => {
        await beginAuthed(contender, user.id);
        try {
          await contender.query(
            `select id from public.create_current_creance(
              $1, $2, $3::date, $4::uuid, null, null, 'EUR'
            )`,
            [payeur.id, 1500, "2026-09-01", randomUUID()],
          );
          await contender.query("commit");
          return { ok: true };
        } catch (error) {
          await contender.query("rollback").catch(() => {});
          return { ok: false, error };
        }
      })();

      await new Promise((r) => setTimeout(r, 50));
      await waitUntilBlocked(observer, contender.processID);

      const { rows } = await holder.query(
        `select id, archived_at from public.archive_current_client_payeur($1)`,
        [payeur.id],
      );
      if (!rows[0]?.archived_at) throw new Error("archivage non réussi");
      await holder.query("commit");

      const createResult = await createPromise;
      if (createResult.ok) throw new Error("création aurait dû échouer");

      const { count } = await admin
        .from("creance")
        .select("id", { count: "exact", head: true })
        .eq("client_payeur_id", payeur.id)
        .is("archived_at", null);
      if (count !== 0) {
        throw new Error("créance active sur client archivé");
      }
    }

    await assertNoArchivedClientWithActiveCreance(payeur.id);
  } finally {
    await holder.query("rollback").catch(() => {});
    await contender.query("rollback").catch(() => {});
    await holder.end().catch(() => {});
    await contender.end().catch(() => {});
    await observer.end().catch(() => {});
  }
}

/**
 * Course update (réaffectation vers B) ↔ archive B.
 */
async function runUpdateArchiveRace(order) {
  const email = `prod-race-upd-${order}-${suffix}@example.com`;
  const user = await createConfirmedUser(email, password);
  const client = await signInAs(email, password);
  await ensurePrestataire(client, "Agence");
  const clientA = await createClientPayeur(client, {
    nom: "A",
    email: `race-a-${order}@example.com`,
    creationKey: randomUUID(),
  });
  const clientB = await createClientPayeur(client, {
    nom: "B",
    email: `race-b-${order}@example.com`,
    creationKey: randomUUID(),
  });
  const draft = await createCreanceDraft(client, {
    clientPayeurId: clientA.id,
    montantCents: 2000,
    dateEcheance: "2026-10-01",
    creationKey: randomUUID(),
  });

  const holder = await openPg();
  const contender = await openPg();
  const observer = await openPg();
  try {
    await beginAuthed(holder, user.id);
    await lockClientRow(holder, clientB.id);

    if (order === "update_first") {
      const archivePromise = (async () => {
        await beginAuthed(contender, user.id);
        try {
          await contender.query(
            `select id from public.archive_current_client_payeur($1)`,
            [clientB.id],
          );
          await contender.query("commit");
          return { ok: true };
        } catch (error) {
          await contender.query("rollback").catch(() => {});
          return { ok: false, error };
        }
      })();

      await new Promise((r) => setTimeout(r, 50));
      await waitUntilBlocked(observer, contender.processID);

      const { rows } = await holder.query(
        `select id, client_payeur_id from public.update_current_creance_draft(
          $1, $2, $3, $4::date, 'réaff', null, 'EUR'
        )`,
        [draft.id, clientB.id, 2000, "2026-10-01"],
      );
      if (rows[0]?.client_payeur_id !== clientB.id) {
        throw new Error("réaffectation non réussie");
      }
      await holder.query("commit");

      const archiveResult = await archivePromise;
      if (archiveResult.ok) throw new Error("archivage B aurait dû échouer");
      const msg = String(archiveResult.error?.message ?? "");
      if (!msg.includes("CLIENT_HAS_ACTIVE_CREANCES")) {
        throw new Error(`archivage B: ${msg}`);
      }
    } else {
      const updatePromise = (async () => {
        await beginAuthed(contender, user.id);
        try {
          await contender.query(
            `select id from public.update_current_creance_draft(
              $1, $2, $3, $4::date, 'réaff', null, 'EUR'
            )`,
            [draft.id, clientB.id, 2000, "2026-10-01"],
          );
          await contender.query("commit");
          return { ok: true };
        } catch (error) {
          await contender.query("rollback").catch(() => {});
          return { ok: false, error };
        }
      })();

      await new Promise((r) => setTimeout(r, 50));
      await waitUntilBlocked(observer, contender.processID);

      const { rows } = await holder.query(
        `select id, archived_at from public.archive_current_client_payeur($1)`,
        [clientB.id],
      );
      if (!rows[0]?.archived_at) throw new Error("archivage B non réussi");
      await holder.query("commit");

      const updateResult = await updatePromise;
      if (updateResult.ok) throw new Error("réaffectation aurait dû échouer");

      const { data: creanceRow } = await admin
        .from("creance")
        .select("client_payeur_id")
        .eq("id", draft.id)
        .single();
      if (creanceRow?.client_payeur_id === clientB.id) {
        throw new Error("créance réaffectée sur client archivé");
      }
    }

    await assertNoArchivedClientWithActiveCreance(clientB.id);
  } finally {
    await holder.query("rollback").catch(() => {});
    await contender.query("rollback").catch(() => {});
    await holder.end().catch(() => {});
    await contender.end().catch(() => {});
    await observer.end().catch(() => {});
  }
}

await runTest("SID-PROD-001 course create→archive (create prend le verrou d'abord)", async () => {
  await runCreateArchiveRace("create_first");
});

await runTest("SID-PROD-001 course archive→create (archive prend le verrou d'abord)", async () => {
  await runCreateArchiveRace("archive_first");
});

await runTest("SID-PROD-001 course update→archive (réaff. prend le verrou d'abord)", async () => {
  await runUpdateArchiveRace("update_first");
});

await runTest("SID-PROD-001 course archive→update (archive prend le verrou d'abord)", async () => {
  await runUpdateArchiveRace("archive_first");
});

await runTest("SID-PROD-001 update brouillon même client autorisé", async () => {
  const email = `prod-upd-same-${suffix}@example.com`;
  await createConfirmedUser(email, password);
  const client = await signInAs(email, password);
  await ensurePrestataire(client, "Agence");
  const payeur = await createClientPayeur(client, {
    nom: "Same",
    email: "same@example.com",
    creationKey: randomUUID(),
  });
  const draft = await createCreanceDraft(client, {
    clientPayeurId: payeur.id,
    montantCents: 1000,
    dateEcheance: "2026-09-01",
    creationKey: randomUUID(),
  });
  const updated = await updateCreanceDraft(client, draft.id, {
    clientPayeurId: payeur.id,
    montantCents: 1200,
    dateEcheance: "2026-09-15",
    libelle: "MAJ",
  });
  if (updated.montant !== 1200) throw new Error("montant");
  if (updated.client_payeur_id !== payeur.id) throw new Error("client");
});

await runTest("SID-PROD-001 update vers client déjà archivé refusé", async () => {
  const email = `prod-upd-arch-${suffix}@example.com`;
  await createConfirmedUser(email, password);
  const client = await signInAs(email, password);
  await ensurePrestataire(client, "Agence");
  const active = await createClientPayeur(client, {
    nom: "Actif",
    email: "actif-upd@example.com",
    creationKey: randomUUID(),
  });
  const toArchive = await createClientPayeur(client, {
    nom: "Archivé",
    email: "arch-upd@example.com",
    creationKey: randomUUID(),
  });
  await archiveClientPayeur(client, toArchive.id);
  const draft = await createCreanceDraft(client, {
    clientPayeurId: active.id,
    montantCents: 1000,
    dateEcheance: "2026-09-01",
    creationKey: randomUUID(),
  });
  let blocked = false;
  try {
    await updateCreanceDraft(client, draft.id, {
      clientPayeurId: toArchive.id,
      montantCents: 1000,
      dateEcheance: "2026-09-01",
    });
  } catch {
    blocked = true;
  }
  if (!blocked) throw new Error("réaff. vers archivé acceptée");
});

await runTest("SID-PROD-001 update vers client autre tenant refusé", async () => {
  const emailA = `prod-upd-xt-a-${suffix}@example.com`;
  const emailB = `prod-upd-xt-b-${suffix}@example.com`;
  await createConfirmedUser(emailA, password);
  await createConfirmedUser(emailB, password);
  const clientA = await signInAs(emailA, password);
  const clientB = await signInAs(emailB, password);
  await ensurePrestataire(clientA, "A");
  await ensurePrestataire(clientB, "B");
  const payeurA = await createClientPayeur(clientA, {
    nom: "A",
    email: "upda@example.com",
    creationKey: randomUUID(),
  });
  const payeurB = await createClientPayeur(clientB, {
    nom: "B",
    email: "updb@example.com",
    creationKey: randomUUID(),
  });
  const draft = await createCreanceDraft(clientA, {
    clientPayeurId: payeurA.id,
    montantCents: 1000,
    dateEcheance: "2026-09-01",
    creationKey: randomUUID(),
  });
  let blocked = false;
  try {
    await updateCreanceDraft(clientA, draft.id, {
      clientPayeurId: payeurB.id,
      montantCents: 1000,
      dateEcheance: "2026-09-01",
    });
  } catch {
    blocked = true;
  }
  if (!blocked) throw new Error("réaff. cross-tenant acceptée");
});

await runTest("SID-PROD-001 update brouillon archivé / hors brouillon refusé", async () => {
  const email = `prod-upd-etat-${suffix}@example.com`;
  await createConfirmedUser(email, password);
  const client = await signInAs(email, password);
  await ensurePrestataire(client, "Agence");
  const payeur = await createClientPayeur(client, {
    nom: "P",
    email: "etat@example.com",
    creationKey: randomUUID(),
  });
  const draft = await createCreanceDraft(client, {
    clientPayeurId: payeur.id,
    montantCents: 1000,
    dateEcheance: "2026-09-01",
    creationKey: randomUUID(),
  });
  await archiveCreance(client, draft.id);
  let archivedBlocked = false;
  try {
    await updateCreanceDraft(client, draft.id, {
      clientPayeurId: payeur.id,
      montantCents: 1100,
      dateEcheance: "2026-09-01",
    });
  } catch {
    archivedBlocked = true;
  }
  if (!archivedBlocked) throw new Error("update créance archivée accepté");

  const open = await createCreanceDraft(client, {
    clientPayeurId: payeur.id,
    montantCents: 1000,
    dateEcheance: "2026-09-01",
    creationKey: randomUUID(),
  });
  await admin.from("creance").update({ etat: "OUVERTE" }).eq("id", open.id);
  let openBlocked = false;
  try {
    await updateCreanceDraft(client, open.id, {
      clientPayeurId: payeur.id,
      montantCents: 1100,
      dateEcheance: "2026-09-01",
    });
  } catch {
    openBlocked = true;
  }
  if (!openBlocked) throw new Error("update hors brouillon accepté");
});

await runTest("SID-PROD-001 aucun helper sidian_test_* dans le schéma", async () => {
  const probe = await admin.rpc("sidian_test_barrier_arm", { p_name: "x" });
  if (!probe.error) throw new Error("sidian_test_barrier_arm encore exposé");

  const pgClient = await openPg();
  try {
    const { rows } = await pgClient.query(
      `select count(*)::int as n
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'sidian_test_%'`,
    );
    if (rows[0].n !== 0) {
      throw new Error(`fonctions sidian_test_* restantes: ${rows[0].n}`);
    }
    const { rows: tables } = await pgClient.query(
      `select count(*)::int as n
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname like 'sidian_test_%'`,
    );
    if (tables[0].n !== 0) {
      throw new Error(`tables sidian_test_* restantes: ${tables[0].n}`);
    }
  } finally {
    await pgClient.end();
  }

  const migration = readFileSync(
    join(root, "supabase/migrations/20260718120000_sid_prod_001_clients_creances.sql"),
    "utf8",
  );
  if (migration.includes("sidian_test_")) {
    throw new Error("sidian_test_* encore dans la migration");
  }
  if (migration.includes("barrier_checkpoint")) {
    throw new Error("checkpoint de test encore dans les RPC");
  }
});

await runTest("SID-PROD-001 creationKey machine : erreur stable, succès rotate, 2 créations", async () => {
  const keys = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
  ];
  const machine = createCreationKeyMachine(() => {
    const next = keys.shift();
    if (!next) throw new Error("plus de clés de test");
    return next;
  });

  const k0 = machine.getKey();
  if (k0 !== "11111111-1111-4111-8111-111111111111") {
    throw new Error("clé initiale");
  }

  // Erreur → même clé (retry)
  const afterError = machine.applyActionResult({ ok: false });
  if (afterError !== k0) throw new Error("clé changée après erreur");

  // Succès → nouvelle clé
  const afterSuccess = machine.applyActionResult({ ok: true });
  if (afterSuccess === k0) throw new Error("clé non renouvelée après succès");
  if (afterSuccess !== "22222222-2222-4222-8222-222222222222") {
    throw new Error("mauvaise rotation");
  }

  // Deuxième création sans remount → encore une autre clé
  const afterSecond = machine.applyActionResult({ ok: true });
  if (afterSecond === afterSuccess) {
    throw new Error("réutilisation de la clé précédente");
  }
  if (afterSecond !== "33333333-3333-4333-8333-333333333333") {
    throw new Error("troisième clé incorrecte");
  }
});

await runTest("SID-PROD-001 formulaires branchés sur creation-key machine", async () => {
  for (const rel of [
    "src/components/app/client-forms.tsx",
    "src/components/app/creance-forms.tsx",
  ]) {
    const source = readFileSync(join(root, rel), "utf8");
    if (!source.includes('from "@/lib/clients/creation-key"')) {
      throw new Error(`import machine absent: ${rel}`);
    }
    if (!source.includes("applyActionResult(result)")) {
      throw new Error(`applyActionResult absent: ${rel}`);
    }
    if (!source.includes("setCreationKey")) {
      throw new Error(`setCreationKey absent: ${rel}`);
    }
    if (/useState\(\(\) => crypto\.randomUUID\(\)\)/.test(source)) {
      throw new Error(`ancienne clé figée sans setter: ${rel}`);
    }
  }
});

await runTest("SID-PROD-001 tests importent les modules cœur", async () => {
  const self = readFileSync(fileURLToPath(import.meta.url), "utf8");
  if (!self.includes("client-payeur-core.ts")) {
    throw new Error("import client cœur absent");
  }
  if (!self.includes("creance-core.ts")) {
    throw new Error("import creance cœur absent");
  }
  if (/async function createClientPayeur\s*\(/.test(self)) {
    throw new Error("helper client dupliqué");
  }
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} tests SID-PROD-001 réussis`);
if (failed.length > 0) process.exit(1);
