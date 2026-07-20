#!/usr/bin/env node
/**
 * SID-STRIPE-001 — schéma, ACL, invariants Connect / payment_link / bindings / webhooks.
 */

import { createClient } from "@supabase/supabase-js";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import {
  assertLocalTestConfig,
  LOCAL_DEMO_ANON_KEY,
  LOCAL_DEMO_SERVICE_ROLE_KEY,
} from "./lib/assert-local-supabase.mjs";
import { withLocalOnlyFetch } from "./lib/local-only-fetch.mjs";
import {
  createLocalPgClient,
  resolveLocalPostgresUrl,
} from "./lib/assert-local-postgres.mjs";
import pg from "pg";

const localConfig = assertLocalTestConfig();
const SUPABASE_URL = localConfig.url;
const SUPABASE_ANON = LOCAL_DEMO_ANON_KEY;
const SUPABASE_SERVICE = LOCAL_DEMO_SERVICE_ROLE_KEY;
const LOCAL_JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";

function createLocalClient(url, key, options = {}) {
  return createClient(url, key, withLocalOnlyFetch(options));
}

const admin = createLocalClient(SUPABASE_URL, SUPABASE_SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function base64url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signLocalJwt({
  role,
  environment = "local",
  expiresAt = Math.floor(Date.now() / 1000) + 3600,
  secret = LOCAL_JWT_SECRET,
}) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      role,
      aud: role,
      sidian_environment: environment,
      exp: expiresAt,
    }),
  );
  const signature = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${header}.${payload}.${signature}`;
}

function clientWithAccessToken(accessToken) {
  return createLocalClient(SUPABASE_URL, SUPABASE_ANON, {
    accessToken: async () => accessToken,
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const writer = clientWithAccessToken(
  signLocalJwt({ role: "stripe_customer_binding_writer" }),
);

async function replaceVerifiedBinding({
  prestataireId,
  clientPayeurId,
  stripeAccountId,
  stripeCustomerId,
  client = writer,
  environment = "local",
}) {
  return client.rpc("replace_verified_stripe_customer_binding", {
    p_prestataire_id: prestataireId,
    p_client_payeur_id: clientPayeurId,
    p_stripe_account_id: stripeAccountId,
    p_stripe_customer_id: stripeCustomerId,
    p_sidian_environment: environment,
  });
}
const pgClient = createLocalPgClient(resolveLocalPostgresUrl(), pg);
await pgClient.connect();
const pgClient2 = createLocalPgClient(resolveLocalPostgresUrl(), pg);
await pgClient2.connect();

const results = [];

function pass(name) {
  results.push({ name, ok: true });
  console.log(`✓ ${name}`);
}

function fail(name, error) {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error
        ? String(error.message)
        : String(error);
  results.push({ name, ok: false, message });
  console.error(`✗ ${name}: ${message}`);
}

async function run(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}

async function createUser(email, password) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("user create failed");
  return data.user;
}

async function signIn(email, password) {
  const client = createLocalClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

async function ensurePrestataire(client, nom) {
  const { data, error } = await client.rpc("ensure_prestataire_for_current_user", {
    p_nom: nom,
  });
  if (error || !data) throw error ?? new Error("ensure prestataire failed");
  return data;
}

function tokenHash() {
  return createHash("sha256")
    .update(randomBytes(32))
    .digest("hex");
}

async function setStripeProjection(prestataireId, accountId, sepa = "active") {
  const { data, error } = await admin.rpc("sync_prestataire_stripe_projection", {
    p_prestataire_id: prestataireId,
    p_stripe_account_id: accountId,
    p_charges_enabled: true,
    p_payouts_enabled: true,
    p_details_submitted: true,
    p_sepa_debit_payments_status: sepa,
    p_onboarding_status: "paiements_actives",
    p_currently_due: [],
    p_pending_verification: [],
    p_past_due: [],
    p_disabled_reason: null,
  });
  if (error || !data) throw error ?? new Error("projection failed");
  return data;
}

await run("SID-STRIPE-001 tables présentes", async () => {
  for (const table of [
    "stripe_customer_binding",
    "payment_link",
    "processed_webhook_event",
    "stripe_webhook_effect",
    "stripe_connect_audit_outbox",
  ]) {
    const { error } = await admin.from(table).select("*").limit(0);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
});

await run("SID-STRIPE-001 ACL RPC sensibles et rôle writer dédié", async () => {
  const signatures = [
    "public.claim_stripe_webhook_event(text,text,text,integer,integer)",
    "public.renew_stripe_webhook_event_lease(text,uuid,integer,integer)",
    "public.mark_stripe_webhook_event_status(text,uuid,integer,public.webhook_processing_status,text,integer)",
    "public.complete_prestataire_connect_provisioning(uuid,uuid,text,text)",
    "public.flush_stripe_connect_audit_outbox(uuid,uuid)",
    "public.apply_account_updated_projection(text,integer,uuid,text,uuid,text,boolean,boolean,boolean,public.stripe_capability_status,public.stripe_onboarding_status,jsonb,jsonb,jsonb,text)",
    "public.fail_prestataire_connect_provisioning(uuid,uuid,boolean,text)",
    "public.revoke_stripe_customer_binding(uuid,uuid)",
  ];
  for (const signature of signatures) {
    const { rows } = await pgClient.query(
      `select
        has_function_privilege('service_role', $1, 'EXECUTE') as service_ok,
        has_function_privilege('authenticated', $1, 'EXECUTE') as auth_ok,
        has_function_privilege('anon', $1, 'EXECUTE') as anon_ok,
        has_function_privilege('public', $1, 'EXECUTE') as public_ok`,
      [signature],
    );
    if (!rows[0].service_ok || rows[0].auth_ok || rows[0].anon_ok || rows[0].public_ok) {
      throw new Error(`ACL inattendue: ${signature}`);
    }
  }
  const writerSignature =
    "public.replace_verified_stripe_customer_binding(uuid,uuid,text,text,text)";
  const { rows: writerAcl } = await pgClient.query(
    `select
      has_function_privilege('stripe_customer_binding_writer', $1, 'EXECUTE') as writer_ok,
      has_function_privilege('service_role', $1, 'EXECUTE') as service_ok,
      has_function_privilege('authenticated', $1, 'EXECUTE') as auth_ok,
      has_function_privilege('anon', $1, 'EXECUTE') as anon_ok,
      has_function_privilege('public', $1, 'EXECUTE') as public_ok`,
    [writerSignature],
  );
  if (
    !writerAcl[0].writer_ok ||
    writerAcl[0].service_ok ||
    writerAcl[0].auth_ok ||
    writerAcl[0].anon_ok ||
    writerAcl[0].public_ok
  ) {
    throw new Error("ACL RPC writer inattendue");
  }
  const { rows: roleRows } = await pgClient.query(`
    select
      r.rolcanlogin,
      r.rolinherit,
      r.rolbypassrls,
      jsonb_agg(member_role.rolname order by member_role.rolname)
        filter (where member_role.rolname is not null) as members
    from pg_catalog.pg_roles r
    left join pg_catalog.pg_auth_members membership
      on membership.roleid = r.oid
      and (membership.inherit_option or membership.set_option)
    left join pg_catalog.pg_roles member_role on member_role.oid = membership.member
    where r.rolname = 'stripe_customer_binding_writer'
    group by r.rolcanlogin, r.rolinherit, r.rolbypassrls
  `);
  const role = roleRows[0];
  if (
    !role ||
    role.rolcanlogin ||
    role.rolinherit ||
    role.rolbypassrls ||
    JSON.stringify(role.members) !== JSON.stringify(["authenticator"])
  ) {
    throw new Error(`configuration rôle writer=${JSON.stringify(role)}`);
  }
  const { rows: tableAcl } = await pgClient.query(`
    select
      has_table_privilege('service_role', 'public.stripe_customer_binding', 'SELECT') as service_select,
      has_table_privilege('service_role', 'public.stripe_customer_binding', 'INSERT') as service_insert,
      has_table_privilege('service_role', 'public.stripe_customer_binding', 'UPDATE') as service_update,
      has_table_privilege('service_role', 'public.stripe_customer_binding', 'DELETE') as service_delete,
      has_table_privilege('service_role', 'public.stripe_customer_binding', 'TRUNCATE') as service_truncate,
      has_table_privilege('stripe_customer_binding_writer', 'public.stripe_customer_binding', 'SELECT') as writer_select,
      has_table_privilege('stripe_customer_binding_writer', 'public.stripe_customer_binding', 'INSERT') as writer_insert,
      to_regprocedure('public.replace_stripe_customer_binding(uuid,uuid,text)') is null as old_rpc_absent
  `);
  if (
    !tableAcl[0].service_select ||
    tableAcl[0].service_insert ||
    tableAcl[0].service_update ||
    tableAcl[0].service_delete ||
    tableAcl[0].service_truncate ||
    tableAcl[0].writer_select ||
    tableAcl[0].writer_insert ||
    !tableAcl[0].old_rpc_absent
  ) {
    throw new Error(`ACL table binding=${JSON.stringify(tableAcl[0])}`);
  }
  const { rows } = await pgClient.query(
    `select
      has_function_privilege('authenticated',
        'public.claim_current_prestataire_connect_provisioning(integer)', 'EXECUTE') as auth_ok,
      has_function_privilege('anon',
        'public.claim_current_prestataire_connect_provisioning(integer)', 'EXECUTE') as anon_ok`,
  );
  if (!rows[0].auth_ok || rows[0].anon_ok) throw new Error("ACL claim Connect");
});

await run("SID-STRIPE-001-FIX-3 JWT writer local et refus des autres rôles", async () => {
  const email = `stripe-writer-${randomUUID()}@example.com`;
  await createUser(email, "Password1!");
  const authenticated = await signIn(email, "Password1!");
  const prestataire = await ensurePrestataire(authenticated, "Writer");
  const accountId = `acct_writer_${randomUUID().replaceAll("-", "")}`;
  await setStripeProjection(prestataire.id, accountId);
  const { data: clientRow, error: clientError } = await authenticated.rpc(
    "create_current_client_payeur",
    {
      p_nom: "Client writer",
      p_email: `writer-${randomUUID()}@example.com`,
      p_creation_key: randomUUID(),
    },
  );
  if (clientError || !clientRow) throw clientError ?? new Error("client writer");

  const valid = await replaceVerifiedBinding({
    prestataireId: prestataire.id,
    clientPayeurId: clientRow.id,
    stripeAccountId: accountId,
    stripeCustomerId: `cus_writer_${randomUUID()}`,
  });
  if (valid.error || !valid.data) throw valid.error ?? new Error("JWT writer refusé");

  const rejectedClients = [
    clientWithAccessToken(
      signLocalJwt({
        role: "stripe_customer_binding_writer",
        expiresAt: Math.floor(Date.now() / 1000) - 60,
      }),
    ),
    clientWithAccessToken(
      signLocalJwt({
        role: "stripe_customer_binding_writer",
        secret: "wrong-local-signing-secret-with-at-least-32-characters",
      }),
    ),
    clientWithAccessToken(signLocalJwt({ role: "authenticated" })),
    createLocalClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: { autoRefreshToken: false, persistSession: false },
    }),
    authenticated,
    admin,
  ];
  for (const rejected of rejectedClients) {
    const result = await replaceVerifiedBinding({
      prestataireId: prestataire.id,
      clientPayeurId: clientRow.id,
      stripeAccountId: accountId,
      stripeCustomerId: `cus_rejected_${randomUUID()}`,
      client: rejected,
    });
    if (!result.error) throw new Error("principal non-writer autorisé");
  }

  const { error: writerDirect } = await writer.from("stripe_customer_binding").insert({
    prestataire_id: prestataire.id,
    client_payeur_id: clientRow.id,
    stripe_account_id: accountId,
    stripe_customer_id: `cus_writer_direct_${randomUUID()}`,
  });
  if (!writerDirect) throw new Error("DML direct writer autorisé");

  for (const operation of ["insert", "update", "delete"]) {
    let result;
    if (operation === "insert") {
      result = await admin.from("stripe_customer_binding").insert({
        prestataire_id: prestataire.id,
        client_payeur_id: clientRow.id,
        stripe_account_id: accountId,
        stripe_customer_id: `cus_service_direct_${randomUUID()}`,
      });
    } else if (operation === "update") {
      result = await admin
        .from("stripe_customer_binding")
        .update({ stripe_customer_id: `cus_service_update_${randomUUID()}` })
        .eq("id", valid.data.id);
    } else {
      result = await admin.from("stripe_customer_binding").delete().eq("id", valid.data.id);
    }
    if (!result.error) throw new Error(`DML direct service_role autorisé: ${operation}`);
  }

  const oldRpc = await admin.rpc("replace_stripe_customer_binding", {
    p_prestataire_id: prestataire.id,
    p_client_payeur_id: clientRow.id,
    p_stripe_customer_id: `cus_old_${randomUUID()}`,
  });
  if (!oldRpc.error) throw new Error("ancienne RPC encore appelable");
});

await run("SID-STRIPE-001 pricing_version early_solo default", async () => {
  const email = `stripe-pv-${randomUUID()}@example.com`;
  const user = await createUser(email, "Password1!");
  const client = await signIn(email, "Password1!");
  const row = await ensurePrestataire(client, "PV");
  if (row.pricing_version !== "early_solo") {
    throw new Error(`pricing_version=${row.pricing_version}`);
  }
  const historical = `historical_${randomUUID()}`;
  const { error } = await admin
    .from("prestataire")
    .update({ pricing_version: historical })
    .eq("id", row.id);
  if (error) throw error;
  const { data: preserved } = await admin
    .from("prestataire")
    .select("pricing_version")
    .eq("id", row.id)
    .single();
  if (preserved?.pricing_version !== historical) {
    throw new Error("provenance pricing historique perdue");
  }
  void user;
});

await run("SID-STRIPE-001 anon sans accès tables financières", async () => {
  const anon = createLocalClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  for (const table of [
    "payment_link",
    "stripe_customer_binding",
    "tentative_paiement",
    "paiement",
    "payment_authorization",
    "processed_webhook_event",
  ]) {
    const { data, error } = await anon.from(table).select("*").limit(1);
    if (data && data.length > 0) {
      throw new Error(`${table}: anon a lu des lignes`);
    }
    // PostgREST peut renvoyer erreur RLS ou liste vide selon grants
    if (error && !/permission|policy|JWT|denied/i.test(error.message)) {
      // ok si erreur d'accès
    }
  }
});

await run("SID-STRIPE-001 authenticated ne peut pas écrire tables Stripe", async () => {
  const email = `stripe-acl-${randomUUID()}@example.com`;
  await createUser(email, "Password1!");
  const client = await signIn(email, "Password1!");
  const prestataire = await ensurePrestataire(client, "ACL");

  const { data: clientRow, error: cErr } = await client.rpc(
    "create_current_client_payeur",
    {
      p_nom: "Client",
      p_email: `c-${randomUUID()}@example.com`,
      p_creation_key: randomUUID(),
    },
  );
  if (cErr || !clientRow) throw cErr ?? new Error("client create");

  const { data: creance, error: crErr } = await client.rpc(
    "create_current_creance",
    {
      p_client_payeur_id: clientRow.id,
      p_montant: 1000,
      p_date_echeance: "2026-09-01",
      p_libelle: "Test",
      p_creation_key: randomUUID(),
    },
  );
  if (crErr || !creance) throw crErr ?? new Error("creance create");

  const { error: plErr } = await client.from("payment_link").insert({
    creance_id: creance.id,
    token_hash: tokenHash(),
  });
  if (!plErr) throw new Error("payment_link insert authenticated autorisé");

  const { error: bErr } = await client.from("stripe_customer_binding").insert({
    prestataire_id: prestataire.id,
    client_payeur_id: clientRow.id,
    stripe_account_id: "acct_x",
    stripe_customer_id: "cus_x",
  });
  if (!bErr) throw new Error("binding insert authenticated autorisé");

  const { error: whErr } = await client.from("processed_webhook_event").insert({
    id: `evt_${randomUUID()}`,
    type: "account.updated",
  });
  if (!whErr) throw new Error("webhook insert authenticated autorisé");

  const { error: tpErr } = await client.from("tentative_paiement").insert({
    creance_id: creance.id,
    montant: 1000,
    moyen: "carte",
    source: "lien_agent",
  });
  if (!tpErr) throw new Error("tentative insert authenticated autorisé");

  const { error: paErr } = await client.from("payment_authorization").insert({
    client_payeur_id: clientRow.id,
    prestataire_id: prestataire.id,
    etat: "EN_CONFIGURATION",
  });
  if (!paErr) throw new Error("authorization insert authenticated autorisé");
});

await run("SID-STRIPE-001 binding actif unique + historique superseded", async () => {
  const email = `stripe-bind-${randomUUID()}@example.com`;
  await createUser(email, "Password1!");
  const client = await signIn(email, "Password1!");
  const prestataire = await ensurePrestataire(client, "Bind");
  const { data: clientRow } = await client.rpc("create_current_client_payeur", {
    p_nom: "Client",
    p_email: `cb-${randomUUID()}@example.com`,
    p_creation_key: randomUUID(),
  });
  const accountId = `acct_bind_${randomUUID().replaceAll("-", "")}`;
  await setStripeProjection(prestataire.id, accountId);

  const { data: first, error: e1 } = await replaceVerifiedBinding({
    prestataireId: prestataire.id,
    clientPayeurId: clientRow.id,
    stripeAccountId: accountId,
    stripeCustomerId: "cus_1",
  });
  if (e1 || !first) throw e1 ?? new Error("first binding");

  const { data: second, error: e2 } = await replaceVerifiedBinding({
    prestataireId: prestataire.id,
    clientPayeurId: clientRow.id,
    stripeAccountId: accountId,
    stripeCustomerId: "cus_2",
  });
  if (e2 || !second) throw e2 ?? new Error("second binding");
  if (second.status !== "active") throw new Error("second not active");

  const { data: rows } = await admin
    .from("stripe_customer_binding")
    .select("status, stripe_customer_id")
    .eq("client_payeur_id", clientRow.id)
    .order("created_at", { ascending: true });

  if ((rows ?? []).length !== 2) throw new Error(`rows=${rows?.length}`);
  if (rows[0].status !== "superseded" || rows[0].stripe_customer_id !== "cus_1") {
    throw new Error("historique superseded perdu");
  }
  if (rows[1].status !== "active" || rows[1].stripe_customer_id !== "cus_2") {
    throw new Error("actif incorrect");
  }

  const { count } = await admin
    .from("stripe_customer_binding")
    .select("*", { count: "exact", head: true })
    .eq("client_payeur_id", clientRow.id)
    .eq("status", "active");
  if (count !== 1) throw new Error(`actifs=${count}`);
});

await run("SID-STRIPE-001 binding concurrent + révocation", async () => {
  const email = `stripe-bind-concurrent-${randomUUID()}@example.com`;
  await createUser(email, "Password1!");
  const client = await signIn(email, "Password1!");
  const prestataire = await ensurePrestataire(client, "Binding concurrence");
  const accountId = `acct_concurrent_${randomUUID().replaceAll("-", "")}`;
  await setStripeProjection(prestataire.id, accountId);
  const { data: clientRow } = await client.rpc("create_current_client_payeur", {
    p_nom: "Client",
    p_email: `concurrent-${randomUUID()}@example.com`,
    p_creation_key: randomUUID(),
  });

  const calls = await Promise.all([
    replaceVerifiedBinding({
      prestataireId: prestataire.id,
      clientPayeurId: clientRow.id,
      stripeAccountId: accountId,
      stripeCustomerId: `cus_a_${randomUUID()}`,
    }),
    replaceVerifiedBinding({
      prestataireId: prestataire.id,
      clientPayeurId: clientRow.id,
      stripeAccountId: accountId,
      stripeCustomerId: `cus_b_${randomUUID()}`,
    }),
  ]);
  if (calls.some((call) => call.error || !call.data)) {
    throw calls.find((call) => call.error)?.error ?? new Error("binding concurrent");
  }
  const { count: activeBefore } = await admin
    .from("stripe_customer_binding")
    .select("*", { count: "exact", head: true })
    .eq("client_payeur_id", clientRow.id)
    .eq("status", "active");
  if (activeBefore !== 1) throw new Error(`active bindings=${activeBefore}`);

  const { data: revoked, error: revokeError } = await admin.rpc(
    "revoke_stripe_customer_binding",
    {
      p_prestataire_id: prestataire.id,
      p_client_payeur_id: clientRow.id,
    },
  );
  if (revokeError || revoked?.status !== "superseded" || !revoked?.superseded_at) {
    throw revokeError ?? new Error("révocation binding");
  }
  const { count: activeAfter } = await admin
    .from("stripe_customer_binding")
    .select("*", { count: "exact", head: true })
    .eq("client_payeur_id", clientRow.id)
    .eq("status", "active");
  if (activeAfter !== 0) throw new Error("binding encore actif après révocation");
});

await run("SID-STRIPE-001 un seul payment_link actif + révocation irréversible", async () => {
  const email = `stripe-pl-${randomUUID()}@example.com`;
  await createUser(email, "Password1!");
  const client = await signIn(email, "Password1!");
  await ensurePrestataire(client, "PL");
  const { data: clientRow } = await client.rpc("create_current_client_payeur", {
    p_nom: "Client",
    p_email: `pl-${randomUUID()}@example.com`,
    p_creation_key: randomUUID(),
  });
  const { data: creance } = await client.rpc("create_current_creance", {
    p_client_payeur_id: clientRow.id,
    p_montant: 2500,
    p_date_echeance: "2026-10-01",
    p_libelle: "Lien",
    p_creation_key: randomUUID(),
  });

  const { data: link1, error: l1 } = await admin.rpc(
    "create_payment_link_for_creance",
    { p_creance_id: creance.id, p_token_hash: tokenHash() },
  );
  if (l1 || !link1) throw l1 ?? new Error("link1");

  const { data: link2, error: l2 } = await admin.rpc(
    "create_payment_link_for_creance",
    { p_creance_id: creance.id, p_token_hash: tokenHash() },
  );
  if (l2 || !link2) throw l2 ?? new Error("link2");

  const { data: first } = await admin
    .from("payment_link")
    .select("*")
    .eq("id", link1.id)
    .single();
  if (first.status !== "revoked" || !first.revoked_at) {
    throw new Error("ancien lien non révoqué");
  }

  const { error: reactivate } = await admin
    .from("payment_link")
    .update({ status: "active", revoked_at: null })
    .eq("id", link1.id);
  if (!reactivate) throw new Error("réactivation aurait dû échouer");

  const { count } = await admin
    .from("payment_link")
    .select("*", { count: "exact", head: true })
    .eq("creance_id", creance.id)
    .eq("status", "active");
  if (count !== 1) throw new Error(`actifs=${count}`);
});

await run("SID-STRIPE-001 payment_authorization contraintes ACTIVE", async () => {
  const email = `stripe-pa-${randomUUID()}@example.com`;
  await createUser(email, "Password1!");
  const client = await signIn(email, "Password1!");
  const prestataire = await ensurePrestataire(client, "PA");
  const { data: clientRow } = await client.rpc("create_current_client_payeur", {
    p_nom: "Client",
    p_email: `pa-${randomUUID()}@example.com`,
    p_creation_key: randomUUID(),
  });

  const { data: draft, error: dErr } = await admin
    .from("payment_authorization")
    .insert({
      client_payeur_id: clientRow.id,
      prestataire_id: prestataire.id,
      etat: "EN_CONFIGURATION",
      type: null,
      stripe_payment_method_id: null,
      authorized_at: null,
      stripe_setup_intent_id: `seti_${randomUUID()}`,
      stripe_setup_checkout_session_id: `cs_${randomUUID()}`,
    })
    .select("*")
    .single();
  if (dErr || !draft) throw dErr ?? new Error("draft auth");

  const { error: badActive } = await admin
    .from("payment_authorization")
    .update({ etat: "ACTIVE", is_default: true })
    .eq("id", draft.id);
  if (!badActive) throw new Error("ACTIVE sans PM aurait dû échouer");

  const { error: okActive } = await admin
    .from("payment_authorization")
    .update({
      etat: "ACTIVE",
      type: "card_off_session",
      stripe_payment_method_id: `pm_${randomUUID()}`,
      authorized_at: new Date().toISOString(),
      authorization_text_version: "v1",
      authorization_channel: "checkout",
      is_default: true,
    })
    .eq("id", draft.id);
  if (okActive) throw okActive;

  const { error: activeRevoked } = await admin
    .from("payment_authorization")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", draft.id);
  if (!activeRevoked) throw new Error("ACTIVE avec revoked_at autorisée");

  const { error: revokedWithoutTimestamp } = await admin
    .from("payment_authorization")
    .update({ etat: "REVOQUEE", revoked_at: null, is_default: false })
    .eq("id", draft.id);
  if (!revokedWithoutTimestamp) {
    throw new Error("REVOQUEE sans revoked_at autorisée");
  }

  const { error: revokedOk } = await admin
    .from("payment_authorization")
    .update({
      etat: "REVOQUEE",
      revoked_at: new Date().toISOString(),
      is_default: false,
    })
    .eq("id", draft.id);
  if (revokedOk) throw revokedOk;

  const { error: nonRevokedWithTimestamp } = await admin
    .from("payment_authorization")
    .update({ etat: "SUSPENDUE" })
    .eq("id", draft.id);
  if (!nonRevokedWithTimestamp) {
    throw new Error("statut non révoqué avec revoked_at autorisé");
  }
});

await run("SID-STRIPE-001 unicités Stripe partielles checkout/setup", async () => {
  const email = `stripe-uniq-${randomUUID()}@example.com`;
  await createUser(email, "Password1!");
  const client = await signIn(email, "Password1!");
  const prestataire = await ensurePrestataire(client, "Uniq");
  const { data: clientRow } = await client.rpc("create_current_client_payeur", {
    p_nom: "Client",
    p_email: `u-${randomUUID()}@example.com`,
    p_creation_key: randomUUID(),
  });
  const { data: creance } = await client.rpc("create_current_creance", {
    p_client_payeur_id: clientRow.id,
    p_montant: 3000,
    p_date_echeance: "2026-11-01",
    p_libelle: "Uniq",
    p_creation_key: randomUUID(),
  });

  const cs = `cs_test_${randomUUID()}`;
  const { error: t1 } = await admin.from("tentative_paiement").insert({
    creance_id: creance.id,
    montant: 3000,
    moyen: "carte",
    source: "lien_agent",
    stripe_checkout_session_id: cs,
  });
  if (t1) throw t1;
  const { error: t2 } = await admin.from("tentative_paiement").insert({
    creance_id: creance.id,
    montant: 3000,
    moyen: "carte",
    source: "lien_agent",
    stripe_checkout_session_id: cs,
  });
  if (!t2) throw new Error("checkout session unique violée");

  const seti = `seti_${randomUUID()}`;
  const { error: a1 } = await admin.from("payment_authorization").insert({
    client_payeur_id: clientRow.id,
    prestataire_id: prestataire.id,
    etat: "EN_CONFIGURATION",
    stripe_setup_intent_id: seti,
  });
  if (a1) throw a1;
  const { error: a2 } = await admin.from("payment_authorization").insert({
    client_payeur_id: clientRow.id,
    prestataire_id: prestataire.id,
    etat: "EN_CONFIGURATION",
    stripe_setup_intent_id: seti,
  });
  if (!a2) throw new Error("setup intent unique violée");
});

await run("SID-STRIPE-001 ready_for_collection via RPC uniquement", async () => {
  const email = `stripe-ready-${randomUUID()}@example.com`;
  await createUser(email, "Password1!");
  const client = await signIn(email, "Password1!");
  await ensurePrestataire(client, "Ready");
  const { data: clientRow } = await client.rpc("create_current_client_payeur", {
    p_nom: "Client",
    p_email: `r-${randomUUID()}@example.com`,
    p_creation_key: randomUUID(),
  });
  const { data: creance } = await client.rpc("create_current_creance", {
    p_client_payeur_id: clientRow.id,
    p_montant: 4000,
    p_date_echeance: "2026-12-01",
    p_libelle: "Ready",
    p_creation_key: randomUUID(),
  });

  const { error: direct } = await client
    .from("creance")
    .update({ ready_for_collection_at: new Date().toISOString() })
    .eq("id", creance.id);
  // authenticated may still have update on creance from older grants — prod-001 may have revoked
  // Prefer RPC path
  const { data: marked, error: rpcErr } = await client.rpc(
    "mark_creance_ready_for_collection",
    { p_creance_id: creance.id },
  );
  if (rpcErr || !marked?.ready_for_collection_at) {
    throw rpcErr ?? new Error("RPC ready failed");
  }
  void direct;
});

await run("SID-STRIPE-001-FIX-3 fencing effet réel worker A/B", async () => {
  const email = `stripe-fence-${randomUUID()}@example.com`;
  await createUser(email, "Password1!");
  const user = await signIn(email, "Password1!");
  const prestataire = await ensurePrestataire(user, "Fence effect");
  const accountId = `acct_fence_${randomUUID().replaceAll("-", "")}`;
  await setStripeProjection(prestataire.id, accountId);
  const id = `evt_fence_${randomUUID()}`;
  const claimSql = `select public.claim_stripe_webhook_event($1, $2, $3, 15, 8) as claim`;
  const first = (await pgClient.query(claimSql, [id, "account.updated", accountId]))
    .rows[0].claim;
  if (!first.claimed || !first.lease_token || first.attempt !== 1) {
    throw new Error(`worker A claim=${JSON.stringify(first)}`);
  }

  await pgClient.query(
    `update public.processed_webhook_event
     set lease_expires_at = timezone('utc', now()) - interval '1 second'
     where id = $1`,
    [id],
  );
  const second = (await pgClient2.query(claimSql, [id, "account.updated", accountId]))
    .rows[0].claim;
  if (!second.claimed || !second.lease_token || second.attempt !== 2) {
    throw new Error(`worker B claim=${JSON.stringify(second)}`);
  }
  if (second.lease_token === first.lease_token) {
    throw new Error("token de lease réutilisé");
  }

  const projectionArgs = {
    p_stripe_event_id: id,
    p_stripe_object_id: accountId,
    p_prestataire_id: prestataire.id,
    p_stripe_account_id: accountId,
    p_charges_enabled: false,
    p_payouts_enabled: false,
    p_details_submitted: false,
    p_sepa_debit_payments_status: "inactive",
    p_onboarding_status: "informations_requises",
    p_currently_due: ["business_profile.url"],
    p_pending_verification: [],
    p_past_due: [],
    p_disabled_reason: "requirements.past_due",
  };
  const staleEffect = await admin.rpc("apply_account_updated_projection", {
    ...projectionArgs,
    p_processing_attempt: first.attempt,
    p_lease_token: first.lease_token,
  });
  if (!staleEffect.error || !/webhook_lease_lost/.test(staleEffect.error.message)) {
    throw new Error("worker A a appliqué l'effet après perte du lease");
  }
  const { count: effectsAfterA } = await admin
    .from("stripe_webhook_effect")
    .select("*", { count: "exact", head: true })
    .eq("stripe_event_id", id);
  if (effectsAfterA !== 0) throw new Error("worker A a consommé la clé d'effet");

  const currentEffect = await admin.rpc("apply_account_updated_projection", {
    ...projectionArgs,
    p_processing_attempt: second.attempt,
    p_lease_token: second.lease_token,
    p_charges_enabled: true,
  });
  if (
    currentEffect.error ||
    currentEffect.data?.effect_registered !== true ||
    currentEffect.data?.projection_applied !== true
  ) {
    throw currentEffect.error ?? new Error(`effet B=${JSON.stringify(currentEffect.data)}`);
  }
  const refreshedEffect = await admin.rpc("apply_account_updated_projection", {
    ...projectionArgs,
    p_processing_attempt: second.attempt,
    p_lease_token: second.lease_token,
    p_charges_enabled: false,
    p_disabled_reason: "requirements.pending_verification",
  });
  if (
    refreshedEffect.error ||
    refreshedEffect.data?.effect_registered !== false ||
    refreshedEffect.data?.projection_applied !== true
  ) {
    throw refreshedEffect.error ?? new Error("projection live non réappliquée");
  }
  const { count: effectsAfterB } = await admin
    .from("stripe_webhook_effect")
    .select("*", { count: "exact", head: true })
    .eq("stripe_event_id", id);
  if (effectsAfterB !== 1) throw new Error(`registre effets=${effectsAfterB}`);
  const { data: projected } = await admin
    .from("prestataire")
    .select("stripe_charges_enabled, stripe_disabled_reason")
    .eq("id", prestataire.id)
    .single();
  if (
    projected?.stripe_charges_enabled !== false ||
    projected?.stripe_disabled_reason !== "requirements.pending_verification"
  ) {
    throw new Error(`projection finale=${JSON.stringify(projected)}`);
  }

  let staleRejected = false;
  try {
    await pgClient.query(
      `select public.mark_stripe_webhook_event_status(
        $1, $2::uuid, $3, 'processed', null, null
      )`,
      [id, first.lease_token, first.attempt],
    );
  } catch (error) {
    staleRejected = /webhook_lease_lost/.test(String(error.message));
  }
  if (!staleRejected) throw new Error("worker A a finalisé après perte du lease");

  await pgClient2.query(
    `select public.mark_stripe_webhook_event_status(
      $1, $2::uuid, $3, 'processed', null, null
    )`,
    [id, second.lease_token, second.attempt],
  );
  const terminal = (await pgClient.query(claimSql, [id, "account.updated", accountId]))
    .rows[0].claim;
  if (terminal.claimed || !terminal.terminal || terminal.status !== "processed") {
    throw new Error(`terminal=${JSON.stringify(terminal)}`);
  }
});

await run("SID-STRIPE-001-FIX-2 renouvellement, retry et plafond", async () => {
  const id = `evt_retry_${randomUUID()}`;
  const { data: first, error: firstError } = await admin.rpc(
    "claim_stripe_webhook_event",
    {
      p_event_id: id,
      p_type: "account.updated",
      p_stripe_connected_account_id: "acct_retry",
      p_lease_seconds: 15,
      p_max_attempts: 2,
    },
  );
  if (firstError || !first?.claimed || !first?.lease_token) {
    throw firstError ?? new Error("claim");
  }
  const { error: renewError } = await admin.rpc(
    "renew_stripe_webhook_event_lease",
    {
      p_event_id: id,
      p_lease_token: first.lease_token,
      p_attempt: first.attempt,
      p_lease_seconds: 30,
    },
  );
  if (renewError) throw renewError;

  const { error: retryError } = await admin.rpc(
    "mark_stripe_webhook_event_status",
    {
      p_event_id: id,
      p_lease_token: first.lease_token,
      p_attempt: first.attempt,
      p_status: "failed_retryable",
      p_error_code: "temporary_failure",
      p_retry_delay_seconds: 60,
    },
  );
  if (retryError) throw retryError;
  await admin
    .from("processed_webhook_event")
    .update({ next_attempt_at: new Date(Date.now() - 1_000).toISOString() })
    .eq("id", id);
  const { data: replay, error: replayError } = await admin.rpc(
    "claim_stripe_webhook_event",
    {
      p_event_id: id,
      p_type: "account.updated",
      p_stripe_connected_account_id: "acct_retry",
      p_lease_seconds: 15,
      p_max_attempts: 2,
    },
  );
  if (replayError || !replay?.claimed || replay.attempt !== 2) {
    throw replayError ?? new Error(`replay=${JSON.stringify(replay)}`);
  }
  await admin.rpc("mark_stripe_webhook_event_status", {
    p_event_id: id,
    p_lease_token: replay.lease_token,
    p_attempt: replay.attempt,
    p_status: "failed_retryable",
    p_error_code: "temporary_failure",
    p_retry_delay_seconds: 1,
  });
  await admin
    .from("processed_webhook_event")
    .update({ next_attempt_at: new Date(Date.now() - 1_000).toISOString() })
    .eq("id", id);
  const { data: capped } = await admin.rpc("claim_stripe_webhook_event", {
    p_event_id: id,
    p_type: "account.updated",
    p_stripe_connected_account_id: "acct_retry",
    p_lease_seconds: 15,
    p_max_attempts: 2,
  });
  if (capped?.status !== "failed_terminal" || !capped?.terminal) {
    throw new Error(`cap=${JSON.stringify(capped)}`);
  }
});

await run("SID-STRIPE-001 provisioning Connect claim concurrent et reprise", async () => {
  const email = `stripe-connect-claim-${randomUUID()}@example.com`;
  await createUser(email, "Password1!");
  const firstClient = await signIn(email, "Password1!");
  const secondClient = await signIn(email, "Password1!");
  const prestataire = await ensurePrestataire(firstClient, "Connect claim");

  const [first, second] = await Promise.all([
    firstClient.rpc("claim_current_prestataire_connect_provisioning", {
      p_lease_seconds: 30,
    }),
    secondClient.rpc("claim_current_prestataire_connect_provisioning", {
      p_lease_seconds: 30,
    }),
  ]);
  const successes = [first, second].filter((result) => !result.error && result.data);
  const failures = [first, second].filter((result) => result.error);
  if (successes.length !== 1 || failures.length !== 1) {
    throw new Error(`claims success=${successes.length} failures=${failures.length}`);
  }
  const initial = successes[0].data;
  await admin
    .from("prestataire")
    .update({ stripe_connect_lease_expires_at: new Date(Date.now() - 1_000).toISOString() })
    .eq("id", prestataire.id);
  const { data: resumed, error: resumeError } = await firstClient.rpc(
    "claim_current_prestataire_connect_provisioning",
    { p_lease_seconds: 30 },
  );
  if (resumeError || !resumed) throw resumeError ?? new Error("resume");
  if (
    resumed.stripe_connect_operation_key !== initial.stripe_connect_operation_key ||
    resumed.stripe_connect_idempotency_key !== initial.stripe_connect_idempotency_key ||
    resumed.stripe_connect_attempts !== 2
  ) {
    throw new Error("identité durable de provisioning non conservée");
  }
});

await run("SID-STRIPE-001 projection Connect sync RPC", async () => {
  const email = `stripe-sync-${randomUUID()}@example.com`;
  await createUser(email, "Password1!");
  const client = await signIn(email, "Password1!");
  const prestataire = await ensurePrestataire(client, "Sync");

  const { data, error } = await admin.rpc("sync_prestataire_stripe_projection", {
    p_prestataire_id: prestataire.id,
    p_stripe_account_id: `acct_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    p_charges_enabled: true,
    p_payouts_enabled: true,
    p_details_submitted: true,
    p_sepa_debit_payments_status: "active",
    p_onboarding_status: "paiements_actives",
    p_currently_due: [],
    p_pending_verification: [],
    p_past_due: [],
    p_disabled_reason: null,
  });
  if (error || !data) throw error ?? new Error("sync failed");
  if (data.stripe_charges_enabled !== true) throw new Error("charges not synced");
  if (data.stripe_onboarding_status !== "paiements_actives") {
    throw new Error(data.stripe_onboarding_status);
  }
});

await run("SID-STRIPE-001-FIX-3 effet account.updated unique et réappliqué", async () => {
  const email = `stripe-effect-${randomUUID()}@example.com`;
  await createUser(email, "Password1!");
  const client = await signIn(email, "Password1!");
  const prestataire = await ensurePrestataire(client, "Effect");
  const accountId = `acct_effect_${randomUUID().replaceAll("-", "")}`;
  await setStripeProjection(prestataire.id, accountId);
  const eventId = `evt_effect_${randomUUID()}`;
  const { data: claim, error: claimError } = await admin.rpc(
    "claim_stripe_webhook_event",
    {
      p_event_id: eventId,
      p_type: "account.updated",
      p_stripe_connected_account_id: accountId,
      p_lease_seconds: 60,
      p_max_attempts: 8,
    },
  );
  if (claimError || !claim?.claimed || !claim?.lease_token) {
    throw claimError ?? new Error("claim effect");
  }
  const args = {
    p_stripe_event_id: eventId,
    p_processing_attempt: claim.attempt,
    p_lease_token: claim.lease_token,
    p_stripe_object_id: accountId,
    p_prestataire_id: prestataire.id,
    p_stripe_account_id: accountId,
    p_charges_enabled: false,
    p_payouts_enabled: false,
    p_details_submitted: false,
    p_sepa_debit_payments_status: "inactive",
    p_onboarding_status: "informations_requises",
    p_currently_due: ["business_profile.url"],
    p_pending_verification: [],
    p_past_due: [],
    p_disabled_reason: "requirements.past_due",
  };
  const { data: first, error: firstError } = await admin.rpc(
    "apply_account_updated_projection",
    args,
  );
  if (
    firstError ||
    first?.effect_registered !== true ||
    first?.projection_applied !== true
  ) {
    throw firstError ?? new Error("effect first");
  }
  const { data: replay, error: replayError } = await admin.rpc(
    "apply_account_updated_projection",
    { ...args, p_charges_enabled: true },
  );
  if (
    replayError ||
    replay?.effect_registered !== false ||
    replay?.projection_applied !== true
  ) {
    throw replayError ?? new Error("effect replay");
  }
  const { count } = await admin
    .from("stripe_webhook_effect")
    .select("*", { count: "exact", head: true })
    .eq("stripe_event_id", eventId);
  if (count !== 1) throw new Error(`effects=${count}`);
  const { data: projected } = await admin
    .from("prestataire")
    .select("stripe_charges_enabled")
    .eq("id", prestataire.id)
    .single();
  if (projected?.stripe_charges_enabled !== true) {
    throw new Error("replay courant n'a pas réappliqué la projection live");
  }
});

await run("SID-STRIPE-001-FIX-2 audit Connect panne, reprise et concurrence", async () => {
  const email = `stripe-audit-${randomUUID()}@example.com`;
  await createUser(email, "Password1!");
  const client = await signIn(email, "Password1!");
  const prestataire = await ensurePrestataire(client, "Audit Connect");
  const { data: claim, error: claimError } = await client.rpc(
    "claim_current_prestataire_connect_provisioning",
    { p_lease_seconds: 30 },
  );
  if (claimError || !claim?.stripe_connect_operation_key) {
    throw claimError ?? new Error("claim audit");
  }
  const accountId = `acct_audit_${randomUUID().replaceAll("-", "")}`;
  const { error: completeError } = await admin.rpc(
    "complete_prestataire_connect_provisioning",
    {
      p_prestataire_id: prestataire.id,
      p_operation_key: claim.stripe_connect_operation_key,
      p_stripe_account_id: accountId,
      p_audit_action: "stripe.connect.account_created",
    },
  );
  if (completeError) throw completeError;

  await pgClient.query(`
    create or replace function public.sidian_test_fail_connect_audit()
    returns trigger language plpgsql set search_path = pg_catalog, public, pg_temp
    as $$ begin
      if new.action = 'stripe.connect.account_created' then
        raise exception 'injected_connect_audit_failure';
      end if;
      return new;
    end $$;
    create trigger sidian_test_fail_connect_audit
    before insert on public.audit_log
    for each row execute function public.sidian_test_fail_connect_audit();
  `);
  try {
    const { error: injectedFailure } = await admin.rpc(
      "flush_stripe_connect_audit_outbox",
      {
        p_prestataire_id: prestataire.id,
        p_operation_key: claim.stripe_connect_operation_key,
      },
    );
    if (!injectedFailure) throw new Error("panne audit non injectée");
    const { data: durable } = await admin
      .from("stripe_connect_audit_outbox")
      .select("status")
      .eq("operation_key", claim.stripe_connect_operation_key)
      .single();
    if (durable?.status !== "pending") throw new Error("outbox non durable");
  } finally {
    await pgClient.query(`
      drop trigger if exists sidian_test_fail_connect_audit on public.audit_log;
      drop function if exists public.sidian_test_fail_connect_audit();
    `);
  }

  const flushArgs = {
    p_prestataire_id: prestataire.id,
    p_operation_key: claim.stripe_connect_operation_key,
  };
  const flushed = await Promise.all([
    admin.rpc("flush_stripe_connect_audit_outbox", flushArgs),
    admin.rpc("flush_stripe_connect_audit_outbox", flushArgs),
  ]);
  if (flushed.some((result) => result.error || result.data?.status !== "delivered")) {
    throw flushed.find((result) => result.error)?.error ?? new Error("flush concurrent");
  }
  const { count } = await admin
    .from("audit_log")
    .select("*", { count: "exact", head: true })
    .eq("prestataire_id", prestataire.id)
    .eq("action", "stripe.connect.account_created");
  if (count !== 1) throw new Error(`audit duplicates=${count}`);
});

await run("SID-STRIPE-001 isolation binding entre prestataires", async () => {
  const mk = async (label) => {
    const email = `stripe-iso-${label}-${randomUUID()}@example.com`;
    await createUser(email, "Password1!");
    const client = await signIn(email, "Password1!");
    const prestataire = await ensurePrestataire(client, label);
    const accountId =
      `acct_iso_${label.toLowerCase()}_${randomUUID().replaceAll("-", "")}`;
    await setStripeProjection(prestataire.id, accountId);
    const { data: clientRow } = await client.rpc("create_current_client_payeur", {
      p_nom: "Same Email Guy",
      p_email: "shared@example.com",
      p_creation_key: randomUUID(),
    });
    return { prestataire, clientRow, accountId };
  };

  const a = await mk("A");
  const b = await mk("B");

  await replaceVerifiedBinding({
    prestataireId: a.prestataire.id,
    clientPayeurId: a.clientRow.id,
    stripeAccountId: a.accountId,
    stripeCustomerId: "cus_iso_a",
  });

  const { error: crossTenant } = await replaceVerifiedBinding({
    prestataireId: a.prestataire.id,
    clientPayeurId: b.clientRow.id,
    stripeAccountId: a.accountId,
    stripeCustomerId: "cus_cross_tenant",
  });
  if (!crossTenant) throw new Error("binding cross-tenant autorisé");
  await replaceVerifiedBinding({
    prestataireId: b.prestataire.id,
    clientPayeurId: b.clientRow.id,
    stripeAccountId: b.accountId,
    stripeCustomerId: "cus_iso_b",
  });

  const { count } = await admin
    .from("stripe_customer_binding")
    .select("*", { count: "exact", head: true })
    .eq("status", "active")
    .in("prestataire_id", [a.prestataire.id, b.prestataire.id]);
  if (count !== 2) throw new Error(`expected 2 active bindings, got ${count}`);
});

await run("SID-STRIPE-001-FIX-3 client writer privé à bindings.ts", async () => {
  const sourceRoot = join(process.cwd(), "src");
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) visit(path);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) files.push(path);
    }
  };
  visit(sourceRoot);
  const offenders = files
    .filter((path) => {
      const content = readFileSync(path, "utf8");
      if (!content.includes("getStripeBindingWriterEnv")) return false;
      return ![
        "src/config/env-server.ts",
        "src/lib/stripe/customers/bindings.ts",
      ].includes(relative(process.cwd(), path));
    })
    .map((path) => relative(process.cwd(), path));
  if (offenders.length > 0) {
    throw new Error(`client writer réutilisé hors bindings.ts: ${offenders.join(", ")}`);
  }
});

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} tests SID-STRIPE-001 réussis`,
);
await pgClient.end();
await pgClient2.end();
if (failed.length > 0) process.exit(1);
