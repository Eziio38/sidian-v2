#!/usr/bin/env node

/**
 * Harnais SQL des préférences de notification.
 *
 * Trois propriétés sont vérifiées, et elles sont indissociables :
 *
 *   1. ISOLATION — un prestataire ne lit ni n'écrit jamais la préférence d'un
 *      autre. La RPC d'écriture ne prend AUCUN identifiant de compte : c'est
 *      l'invariant central, et le test vérifie sa signature, pas seulement son
 *      comportement.
 *
 *   2. VERROUILLAGE DES ÉCRITURES — aucun UPDATE / INSERT / DELETE PostgREST
 *      direct n'est possible pour `authenticated`. La seule porte est la RPC,
 *      qui trace le changement dans `audit_log`.
 *
 *   3. HONNÊTETÉ DU PÉRIMÈTRE — la table ne porte que les deux événements que
 *      le runtime émet réellement. Si quelqu'un ajoute une colonne pour un
 *      gabarit qui ne part jamais, ce test tombe et la décision devra être
 *      assumée, pas subie.
 */

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

const PASSWORD = "NotificationPrefs123!";

/** Les deux seuls événements réglables — miroir de NOTIFICATION_EVENTS (TS). */
const EXPECTED_PREFERENCE_COLUMNS = [
  "email_payment_failed",
  "email_reminder_before_due",
];

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

async function createUser(email) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("user_create_failed");
  return data.user;
}

async function signIn(email) {
  const auth = localClient(LOCAL_DEMO_ANON_KEY);
  const { data, error } = await auth.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error || !data.session) throw error ?? new Error("sign_in_failed");
  return localClient(LOCAL_DEMO_ANON_KEY, {
    global: {
      headers: { Authorization: `Bearer ${data.session.access_token}` },
    },
  });
}

async function seedTenant(label, email) {
  const user = await createUser(email);
  const { data, error } = await admin
    .from("prestataire")
    .insert({ user_id: user.id, nom: `Cabinet ${label}`, email })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("prestataire_insert_failed");
  return { user, email, prestataireId: data.id };
}

async function auditCount(prestataireId) {
  const { count, error } = await admin
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("prestataire_id", prestataireId)
    .eq("action", "prestataire.notification_preferences_updated");
  if (error) throw error;
  return count ?? 0;
}

async function main() {
  const postgres = createLocalPgClient(resolveLocalPostgresUrl(), pg);
  await postgres.connect();

  try {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const a = await seedTenant("A", `notif-a-${suffix}@sidian.test`);
    const b = await seedTenant("B", `notif-b-${suffix}@sidian.test`);

    const clientA = await signIn(a.email);
    const clientB = await signIn(b.email);

    // -----------------------------------------------------------------------
    // 1. Périmètre — deux colonnes réglables, pas une de plus
    // -----------------------------------------------------------------------

    const { rows: columnRows } = await postgres.query(
      `select column_name
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'notification_preference'
          and column_name like 'email\\_%'
        order by column_name`,
    );
    assert(
      JSON.stringify(columnRows.map((row) => row.column_name)) ===
        JSON.stringify(EXPECTED_PREFERENCE_COLUMNS),
      "la table expose des événements que le runtime n'émet pas (ou en oublie un)",
    );

    // -----------------------------------------------------------------------
    // 2. Structure — RLS, signature sans tenant, search_path, droits
    // -----------------------------------------------------------------------

    const { data: inventory, error: inventoryError } = await admin.rpc(
      "sidian_assert_rls_enabled",
    );
    if (inventoryError) throw inventoryError;
    const inventoried = inventory.find(
      (row) => row.table_name === "notification_preference",
    );
    assert(
      inventoried?.rls_enabled === true,
      "notification_preference n'est pas couverte par l'inventaire RLS",
    );

    const { rows: signatureRows } = await postgres.query(
      `select
         pg_get_function_identity_arguments(p.oid) as args,
         p.prosecdef as security_definer,
         p.proconfig as config
       from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = 'set_current_prestataire_notification_preferences'`,
    );
    assert(signatureRows.length === 1, "la RPC d'écriture est introuvable");
    assert(
      signatureRows[0].args ===
        "p_email_reminder_before_due boolean, p_email_payment_failed boolean",
      "la RPC accepte un paramètre inattendu — aucun identifiant de tenant n'est admis",
    );
    assert(
      signatureRows[0].security_definer === true,
      "la RPC n'est pas security definer",
    );
    assert(
      (signatureRows[0].config ?? []).includes(
        "search_path=pg_catalog, public, pg_temp",
      ),
      "la RPC n'épingle pas le search_path conventionnel",
    );

    const { rows: grantRows } = await postgres.query(
      `select
         has_function_privilege('authenticated', $1, 'execute') as authenticated,
         has_function_privilege('anon', $1, 'execute') as anon,
         has_function_privilege('service_role', $1, 'execute') as service_role`,
      [
        "public.set_current_prestataire_notification_preferences(boolean,boolean)",
      ],
    );
    assert(grantRows[0].authenticated === true, "authenticated doit exécuter la RPC");
    assert(grantRows[0].anon === false, "anon ne doit pas exécuter la RPC");
    assert(
      grantRows[0].service_role === false,
      "service_role ne doit pas exécuter une RPC dérivant auth.uid()",
    );

    // -----------------------------------------------------------------------
    // 3. Défauts — aucune ligne tant que rien n'a été réglé
    // -----------------------------------------------------------------------

    const { data: beforeRows, error: beforeError } = await clientA
      .from("notification_preference")
      .select("prestataire_id");
    if (beforeError) throw beforeError;
    assert(
      beforeRows.length === 0,
      "une ligne de préférences existe avant tout réglage",
    );

    // -----------------------------------------------------------------------
    // 4. Écriture — la RPC crée la ligne du prestataire authentifié
    // -----------------------------------------------------------------------

    const { data: writtenA, error: writeAError } = await clientA.rpc(
      "set_current_prestataire_notification_preferences",
      {
        p_email_reminder_before_due: false,
        p_email_payment_failed: true,
      },
    );
    if (writeAError) throw writeAError;
    assert(
      writtenA.prestataire_id === a.prestataireId &&
        writtenA.email_reminder_before_due === false &&
        writtenA.email_payment_failed === true,
      "la RPC n'a pas écrit la préférence du prestataire authentifié",
    );
    assert(
      (await auditCount(a.prestataireId)) === 1,
      "le premier réglage n'est pas tracé dans audit_log",
    );

    // -----------------------------------------------------------------------
    // 5. Idempotence — rejouer la même valeur n'ajoute pas de trace
    // -----------------------------------------------------------------------

    const { error: replayError } = await clientA.rpc(
      "set_current_prestataire_notification_preferences",
      {
        p_email_reminder_before_due: false,
        p_email_payment_failed: true,
      },
    );
    if (replayError) throw replayError;
    assert(
      (await auditCount(a.prestataireId)) === 1,
      "un réglage identique produit une trace d'audit en double",
    );

    const { error: changeError } = await clientA.rpc(
      "set_current_prestataire_notification_preferences",
      {
        p_email_reminder_before_due: true,
        p_email_payment_failed: false,
      },
    );
    if (changeError) throw changeError;
    assert(
      (await auditCount(a.prestataireId)) === 2,
      "un changement réel n'est pas tracé",
    );

    // -----------------------------------------------------------------------
    // 6. Isolation — B ne voit ni ne modifie la ligne de A
    // -----------------------------------------------------------------------

    const { data: seenByB, error: seenByBError } = await clientB
      .from("notification_preference")
      .select("prestataire_id");
    if (seenByBError) throw seenByBError;
    assert(
      seenByB.length === 0,
      "B lit la ligne de préférences d'un autre prestataire",
    );

    const { error: crossUpdateError } = await clientB
      .from("notification_preference")
      .update({ email_payment_failed: true })
      .eq("prestataire_id", a.prestataireId);
    const { data: afterCross } = await admin
      .from("notification_preference")
      .select("email_payment_failed")
      .eq("prestataire_id", a.prestataireId)
      .single();
    assert(
      afterCross.email_payment_failed === false,
      `B a modifié la préférence de A (erreur PostgREST : ${
        crossUpdateError?.message ?? "aucune"
      })`,
    );

    // B règle sa propre ligne : la RPC vise bien SON compte, jamais celui de A.
    const { data: writtenB, error: writeBError } = await clientB.rpc(
      "set_current_prestataire_notification_preferences",
      {
        p_email_reminder_before_due: false,
        p_email_payment_failed: false,
      },
    );
    if (writeBError) throw writeBError;
    assert(
      writtenB.prestataire_id === b.prestataireId,
      "la RPC de B a visé un autre prestataire",
    );

    const { data: aStillIntact } = await admin
      .from("notification_preference")
      .select("email_reminder_before_due, email_payment_failed")
      .eq("prestataire_id", a.prestataireId)
      .single();
    assert(
      aStillIntact.email_reminder_before_due === true &&
        aStillIntact.email_payment_failed === false,
      "le réglage de B a altéré celui de A",
    );

    // -----------------------------------------------------------------------
    // 7. Écriture directe interdite — la RPC est la seule porte
    // -----------------------------------------------------------------------

    const { error: selfUpdateError } = await clientA
      .from("notification_preference")
      .update({ email_payment_failed: true })
      .eq("prestataire_id", a.prestataireId);
    const { data: afterSelfUpdate } = await admin
      .from("notification_preference")
      .select("email_payment_failed")
      .eq("prestataire_id", a.prestataireId)
      .single();
    assert(
      afterSelfUpdate.email_payment_failed === false,
      `un UPDATE PostgREST direct a contourné la RPC (erreur : ${
        selfUpdateError?.message ?? "aucune"
      })`,
    );

    const { error: selfInsertError } = await clientA
      .from("notification_preference")
      .insert({ prestataire_id: b.prestataireId });
    assert(
      Boolean(selfInsertError),
      "un INSERT PostgREST direct est accepté pour authenticated",
    );

    const { error: selfDeleteError } = await clientA
      .from("notification_preference")
      .delete()
      .eq("prestataire_id", a.prestataireId);
    const { count: remaining } = await admin
      .from("notification_preference")
      .select("prestataire_id", { count: "exact", head: true })
      .eq("prestataire_id", a.prestataireId);
    assert(
      remaining === 1,
      `un DELETE PostgREST direct a supprimé la préférence (erreur : ${
        selfDeleteError?.message ?? "aucune"
      })`,
    );

    // -----------------------------------------------------------------------
    // 8. Anonyme — aucune lecture, aucune écriture
    // -----------------------------------------------------------------------

    const anon = localClient(LOCAL_DEMO_ANON_KEY);
    const { data: anonRows } = await anon
      .from("notification_preference")
      .select("prestataire_id");
    assert(
      (anonRows ?? []).length === 0,
      "un client anonyme lit des préférences",
    );

    const { error: anonRpcError } = await anon.rpc(
      "set_current_prestataire_notification_preferences",
      {
        p_email_reminder_before_due: true,
        p_email_payment_failed: true,
      },
    );
    assert(Boolean(anonRpcError), "un client anonyme exécute la RPC d'écriture");

    console.log(
      `✓ Préférences de notification : ${passed} assertions.`,
    );
  } finally {
    await postgres.end();
  }
}

main().catch((error) => {
  console.error("✗ test-notification-preferences", error);
  process.exitCode = 1;
});
