#!/usr/bin/env node
/**
 * Tests structurels et RLS — Supabase local.
 * Les tests d'isolation utilisent des JWT authenticated réels.
 * Le service role est réservé à la préparation des fixtures et aux contrôles d'intégrité SQL.
 */

import { createClient } from "@supabase/supabase-js";

const LOCAL_URL = "http://127.0.0.1:54321";
const LOCAL_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const LOCAL_SERVICE =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? LOCAL_URL;
const SUPABASE_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? LOCAL_ANON;
const SUPABASE_SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? LOCAL_SERVICE;

const EXPECTED_TABLES = [
  "prestataire",
  "client_payeur",
  "creance",
  "tentative_paiement",
  "paiement",
  "payment_authorization",
  "dossier_suivi",
  "regle",
  "conversation",
  "message",
  "approval_request",
  "audit_log",
  "processed_webhook_event",
];

const FORBIDDEN_TABLES = [
  "facture",
  "contrat",
  "mission",
  "mandat",
  "enrollment",
  "evenement_bancaire",
  "organization_members",
];

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE, {
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

async function createAuthUser(email, password) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  return data.user;
}

async function signIn(email, password) {
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await authClient.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: {
      headers: { Authorization: `Bearer ${data.session.access_token}` },
    },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function anonClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function main() {
  await runTest("les 13 tables métier existent", async () => {
    for (const table of EXPECTED_TABLES) {
      const { error } = await admin.from(table).select("*").limit(0);
      if (error) throw new Error(`${table}: ${error.message}`);
    }
  });

  await runTest("RLS est activée sur toutes les tables métier", async () => {
    const { data, error } = await admin.rpc("sidian_assert_rls_enabled");
    if (error) throw error;
    const rows = data ?? [];
    if (rows.length !== EXPECTED_TABLES.length) {
      throw new Error(`attendu ${EXPECTED_TABLES.length} tables, reçu ${rows.length}`);
    }
    const disabled = rows.filter((row) => !row.rls_enabled);
    if (disabled.length > 0) {
      throw new Error(
        `RLS désactivée: ${disabled.map((row) => row.table_name).join(", ")}`,
      );
    }
  });

  const suffix = Date.now();
  const emailA = `prestataire-a-${suffix}@sidian.test`;
  const emailB = `prestataire-b-${suffix}@sidian.test`;
  const password = "TestPassword123!";

  let prestA;
  let prestB;
  let clientA;
  let clientB;
  let clientPayeurA;
  let clientPayeurB;
  let creanceA;
  let creanceB;
  let conversationA;
  let messageA;
  let auditRow;
  let tentativeA;

  await runTest("préparation des prestataires de test", async () => {
    const userA = await createAuthUser(emailA, password);
    const userB = await createAuthUser(emailB, password);

    const { data: dataA, error: errorA } = await admin
      .from("prestataire")
      .insert({
        user_id: userA.id,
        nom: "Agence A",
        email: emailA,
      })
      .select("id")
      .single();
    if (errorA) throw errorA;
    prestA = dataA;

    const { data: dataB, error: errorB } = await admin
      .from("prestataire")
      .insert({
        user_id: userB.id,
        nom: "Agence B",
        email: emailB,
      })
      .select("id")
      .single();
    if (errorB) throw errorB;
    prestB = dataB;

    clientA = await signIn(emailA, password);
    clientB = await signIn(emailB, password);
  });

  await runTest("utilisateur A ne lit pas les données du prestataire B (JWT)", async () => {
    const { data: cpB, error: cpError } = await admin
      .from("client_payeur")
      .insert({
        prestataire_id: prestB.id,
        nom: "Client B",
        email: "client-b@example.com",
      })
      .select("id")
      .single();
    if (cpError) throw cpError;
    clientPayeurB = cpB;

    const { data, error } = await clientA.from("client_payeur").select("id, email");
    if (error) throw error;
    const leaked = (data ?? []).some((row) => row.email === "client-b@example.com");
    if (leaked) throw new Error("fuite cross-tenant via JWT authenticated");
  });

  await runTest("utilisateur A ne peut pas insérer sur le prestataire B (JWT)", async () => {
    const { error } = await clientA.from("client_payeur").insert({
      prestataire_id: prestB.id,
      nom: "Client intrus",
      email: "intrus@example.com",
    });
    if (!error) throw new Error("insertion cross-tenant autorisée");
  });

  await runTest("utilisateur A ne peut pas modifier les données du prestataire B (JWT)", async () => {
    const { data: updated, error } = await clientA
      .from("client_payeur")
      .update({ nom: "Piraté" })
      .eq("id", clientPayeurB.id)
      .select("id");
    if (error) throw error;
    if ((updated ?? []).length > 0) {
      throw new Error("update cross-tenant autorisé");
    }
  });

  await runTest("anon ne peut pas lire les tables métier", async () => {
    const { data, error } = await anonClient().from("creance").select("id").limit(1);
    if (!error && (data ?? []).length > 0) {
      throw new Error("anon peut lire creance");
    }
  });

  await runTest("le propriétaire peut lire ses propres créances (JWT)", async () => {
    const { data: cp, error: cpError } = await admin
      .from("client_payeur")
      .insert({
        prestataire_id: prestA.id,
        nom: "Client A",
        email: "client-a@example.com",
      })
      .select("id")
      .single();
    if (cpError) throw cpError;
    clientPayeurA = cp;

    const { data: creance, error: creanceError } = await admin
      .from("creance")
      .insert({
        prestataire_id: prestA.id,
        client_payeur_id: clientPayeurA.id,
        montant: 10000,
        origine: "import_manuel",
        date_echeance: "2026-08-01",
        etat: "OUVERTE",
      })
      .select("id")
      .single();
    if (creanceError) throw creanceError;
    creanceA = creance;

    const { data, error } = await clientA
      .from("creance")
      .select("id")
      .eq("id", creanceA.id);
    if (error) throw error;
    if ((data ?? []).length !== 1) {
      throw new Error("le propriétaire ne lit pas sa créance");
    }
  });

  await runTest("incohérence creance/client_payeur refusée (trigger SQL)", async () => {
    const { error } = await admin.from("creance").insert({
      prestataire_id: prestA.id,
      client_payeur_id: clientPayeurB.id,
      montant: 5000,
      origine: "import_manuel",
      date_echeance: "2026-08-01",
    });
    if (!error) throw new Error("scope creance/client accepté");
  });

  await runTest("incohérence conversation/créance/client refusée (trigger SQL)", async () => {
    const { error } = await admin.from("conversation").insert({
      prestataire_id: prestA.id,
      creance_id: creanceA.id,
      client_payeur_id: clientPayeurB.id,
    });
    if (!error) throw new Error("scope conversation accepté");
  });

  await runTest("préparation tentative de paiement", async () => {
    const { data: tentative, error } = await admin
      .from("tentative_paiement")
      .insert({
        creance_id: creanceA.id,
        montant: 10000,
        moyen: "carte",
        source: "lien_agent",
        etat: "REUSSIE",
      })
      .select("id")
      .single();
    if (error) throw error;
    tentativeA = tentative;

    const { data: creanceBData, error: creanceBError } = await admin
      .from("creance")
      .insert({
        prestataire_id: prestB.id,
        client_payeur_id: clientPayeurB.id,
        montant: 20000,
        origine: "import_manuel",
        date_echeance: "2026-08-15",
        etat: "OUVERTE",
      })
      .select("id")
      .single();
    if (creanceBError) throw creanceBError;
    creanceB = creanceBData;
  });

  await runTest("incohérence paiement/tentative/créance refusée (trigger SQL)", async () => {
    const { error } = await admin.from("paiement").insert({
      creance_id: creanceB.id,
      tentative_paiement_id: tentativeA.id,
      montant: 10000,
      source: "lien_agent",
    });
    if (!error) throw new Error("paiement hors scope accepté");
  });

  await runTest("authenticated ne peut pas insérer un paiement confirmé (JWT)", async () => {
    const { error } = await clientA.from("paiement").insert({
      creance_id: creanceA.id,
      tentative_paiement_id: tentativeA.id,
      montant: 10000,
      source: "lien_agent",
    });
    if (!error) throw new Error("insert paiement autorisé côté authenticated");
  });

  await runTest("authenticated ne peut pas insérer une tentative (JWT)", async () => {
    const { error } = await clientA.from("tentative_paiement").insert({
      creance_id: creanceA.id,
      montant: 1000,
      moyen: "carte",
      source: "lien_agent",
    });
    if (!error) throw new Error("insert tentative autorisé côté authenticated");
  });

  await runTest("authenticated ne peut pas insérer un webhook (JWT)", async () => {
    const { error } = await clientA
      .from("processed_webhook_event")
      .insert({ id: `evt_auth_${suffix}`, type: "test.event" });
    if (!error) throw new Error("insert webhook autorisé côté authenticated");
  });

  await runTest("authenticated ne peut pas lire processed_webhook_event (JWT)", async () => {
    const { data, error } = await clientA
      .from("processed_webhook_event")
      .select("id")
      .limit(1);
    if (!error && (data ?? []).length > 0) {
      throw new Error("lecture webhook autorisée côté authenticated");
    }
  });

  await runTest("impossible de modifier les champs commerciaux sensibles (JWT)", async () => {
    const { error } = await clientA
      .from("prestataire")
      .update({ subscription_status: "active", platform_fee_basis_points: 100 })
      .eq("id", prestA.id);
    if (!error) throw new Error("update champs sensibles autorisé");
  });

  await runTest("préparation conversation/message/audit", async () => {
    const { data: conversation, error: convError } = await admin
      .from("conversation")
      .insert({
        prestataire_id: prestA.id,
        creance_id: creanceA.id,
        client_payeur_id: clientPayeurA.id,
      })
      .select("id")
      .single();
    if (convError) throw convError;
    conversationA = conversation;

    const { data: message, error: msgError } = await admin
      .from("message")
      .insert({
        conversation_id: conversationA.id,
        emetteur: "agent",
        contenu: "Message test",
        canal: "email",
        actor_type: "sidian_agent",
      })
      .select("id")
      .single();
    if (msgError) throw msgError;
    messageA = message;

    const { data: audit, error: auditError } = await admin
      .from("audit_log")
      .insert({
        prestataire_id: prestA.id,
        actor_type: "system",
        action: "test",
        entity_type: "creance",
        entity_id: creanceA.id,
      })
      .select("id")
      .single();
    if (auditError) throw auditError;
    auditRow = audit;
  });

  await runTest("un message ne peut pas être modifié (JWT)", async () => {
    const { error } = await clientA
      .from("message")
      .update({ contenu: "modifié" })
      .eq("id", messageA.id);
    if (!error) throw new Error("update message autorisé");
  });

  await runTest("un message ne peut pas être supprimé (JWT)", async () => {
    const { error } = await clientA
      .from("message")
      .delete()
      .eq("id", messageA.id);
    if (!error) throw new Error("delete message autorisé");
  });

  await runTest("un audit_log ne peut pas être modifié (JWT)", async () => {
    const { error } = await clientA
      .from("audit_log")
      .update({ action: "hack" })
      .eq("id", auditRow.id);
    if (!error) throw new Error("update audit_log autorisé");
  });

  await runTest("audit_log incohérent refusé (trigger SQL)", async () => {
    const { error } = await admin.from("audit_log").insert({
      prestataire_id: prestB.id,
      actor_type: "system",
      action: "test",
      entity_type: "creance",
      entity_id: creanceA.id,
    });
    if (!error) throw new Error("audit_log scope accepté");
  });

  await runTest("plusieurs autorisations ACTIVE sans is_default sont autorisées", async () => {
    const { error: firstError } = await admin.from("payment_authorization").insert({
      client_payeur_id: clientPayeurA.id,
      prestataire_id: prestA.id,
      type: "card_off_session",
      stripe_payment_method_id: "pm_active_1",
      etat: "ACTIVE",
      is_default: false,
    });
    if (firstError) throw firstError;

    const { error: secondError } = await admin.from("payment_authorization").insert({
      client_payeur_id: clientPayeurA.id,
      prestataire_id: prestA.id,
      type: "sepa_core_mandate",
      stripe_payment_method_id: "pm_active_2",
      stripe_mandate_id: "mandate_active_2",
      etat: "ACTIVE",
      is_default: false,
    });
    if (secondError) throw new Error("plusieurs ACTIVE non-default refusées");
  });

  await runTest("autorisation is_default non ACTIVE refusée (contrainte SQL)", async () => {
    const { error } = await admin.from("payment_authorization").insert({
      client_payeur_id: clientPayeurA.id,
      prestataire_id: prestA.id,
      type: "card_off_session",
      stripe_payment_method_id: "pm_default_inactive",
      etat: "PROPOSEE",
      is_default: true,
    });
    if (!error) throw new Error("is_default sur état non ACTIVE accepté");
  });

  await runTest("deux autorisations par défaut pour le même couple sont refusées", async () => {
    const { error: firstError } = await admin.from("payment_authorization").insert({
      client_payeur_id: clientPayeurA.id,
      prestataire_id: prestA.id,
      type: "card_off_session",
      stripe_payment_method_id: "pm_default_1",
      etat: "ACTIVE",
      is_default: true,
    });
    if (firstError) throw firstError;

    const { error: secondError } = await admin.from("payment_authorization").insert({
      client_payeur_id: clientPayeurA.id,
      prestataire_id: prestA.id,
      type: "sepa_core_mandate",
      stripe_payment_method_id: "pm_default_2",
      stripe_mandate_id: "mandate_default_2",
      etat: "ACTIVE",
      is_default: true,
    });
    if (!secondError) throw new Error("double is_default autorisé");
  });

  await runTest("un montant nul ou négatif est refusé", async () => {
    const { error } = await admin.from("creance").insert({
      prestataire_id: prestA.id,
      client_payeur_id: clientPayeurA.id,
      montant: 0,
      origine: "import_manuel",
      date_echeance: "2026-08-01",
    });
    if (!error) throw new Error("montant nul accepté");
  });

  await runTest("un webhook avec le même identifiant est refusé deux fois", async () => {
    const eventId = `evt_test_${suffix}`;
    const { error: firstError } = await admin
      .from("processed_webhook_event")
      .insert({ id: eventId, type: "payment_intent.succeeded" });
    if (firstError) throw firstError;

    const { error: secondError } = await admin
      .from("processed_webhook_event")
      .insert({ id: eventId, type: "payment_intent.succeeded" });
    if (!secondError) throw new Error("doublon webhook accepté");
  });

  await runTest("une seule ligne dossier_suivi est possible par créance", async () => {
    const { error: firstError } = await admin.from("dossier_suivi").insert({
      creance_id: creanceA.id,
      etat: "PREVENTION",
    });
    if (firstError) throw firstError;

    const { error: secondError } = await admin.from("dossier_suivi").insert({
      creance_id: creanceA.id,
      etat: "ECHEANCE",
    });
    if (!secondError) throw new Error("double dossier_suivi autorisé");
  });

  await runTest("aucune table legacy interdite n'existe", async () => {
    for (const table of FORBIDDEN_TABLES) {
      const { error } = await admin.from(table).select("id").limit(0);
      if (!error) throw new Error(`table legacy présente: ${table}`);
    }
  });

  await runTest("les enums actifs rejettent les valeurs invalides", async () => {
    const { error } = await admin.from("creance").insert({
      prestataire_id: prestA.id,
      client_payeur_id: clientPayeurA.id,
      montant: 1000,
      origine: "import_manuel",
      date_echeance: "2026-08-01",
      etat: "INVALIDE",
    });
    if (!error) throw new Error("enum creance_etat invalide accepté");
  });

  void clientB;
  void creanceB;

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} tests réussis`);
  if (failed.length > 0) process.exit(1);
}

main();
