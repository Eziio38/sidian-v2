#!/usr/bin/env node
/**
 * SID-STRIPE-002-A — ouverture, token serveur, invariants Checkout et rate limit.
 */

import { createHash, createHmac, randomUUID } from "node:crypto";
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
const SUPABASE_ANON = LOCAL_DEMO_ANON_KEY;
const SUPABASE_SERVICE = LOCAL_DEMO_SERVICE_ROLE_KEY;

function localClient(key, options = {}) {
  return createClient(SUPABASE_URL, key, withLocalOnlyFetch(options));
}

const admin = localClient(SUPABASE_SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = localClient(SUPABASE_ANON, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const postgres = createLocalPgClient(resolveLocalPostgresUrl(), pg);
await postgres.connect();

const results = [];

function errorMessage(error) {
  return error instanceof Error
    ? error.message
    : error && typeof error === "object" && "message" in error
      ? String(error.message)
      : String(error);
}

async function run(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`✓ ${name}`);
  } catch (error) {
    results.push({ name, ok: false, message: errorMessage(error) });
    console.error(`✗ ${name}: ${errorMessage(error)}`);
  }
}

async function createUserAndClient(label) {
  const email = `${label}-${randomUUID()}@sidian.test`;
  const password = "Password1!";
  const { error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userError) throw userError;

  const client = localClient(SUPABASE_ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) throw signInError;

  const { data: prestataire, error: prestataireError } = await client.rpc(
    "ensure_prestataire_for_current_user",
    { p_nom: `Prestataire ${label}` },
  );
  if (prestataireError || !prestataire) {
    throw prestataireError ?? new Error("prestataire absent");
  }
  return { client, prestataire };
}

async function createDraft(client, label = "paiement") {
  const { data: clientPayeur, error: clientError } = await client.rpc(
    "create_current_client_payeur",
    {
      p_nom: `Client ${label}`,
      p_email: `${label}-${randomUUID()}@example.com`,
      p_creation_key: randomUUID(),
    },
  );
  if (clientError || !clientPayeur) {
    throw clientError ?? new Error("client payeur absent");
  }

  const { data: creance, error: creanceError } = await client.rpc(
    "create_current_creance",
    {
      p_client_payeur_id: clientPayeur.id,
      p_montant: 12000,
      p_date_echeance: "2026-12-15",
      p_creation_key: randomUUID(),
      p_libelle: label,
    },
  );
  if (creanceError || !creance) {
    throw creanceError ?? new Error("créance absente");
  }
  return { clientPayeur, creance };
}

function subjectHash(namespace, value) {
  return createHmac("sha256", `sid-stripe-002-a-${namespace}`)
    .update(value)
    .digest("hex");
}

const tenantA = await createUserAndClient("stripe-002-a");

await run("BROUILLON devient OUVERTE avec lien et audits transactionnels", async () => {
  const { creance } = await createDraft(tenantA.client, "ouverture");
  const { data, error } = await tenantA.client.rpc("open_payment_receivable", {
    p_creance_id: creance.id,
  });
  if (error || !data) throw error ?? new Error("résultat absent");
  if (
    data.creance_state !== "OUVERTE" ||
    data.opened !== true ||
    data.payment_link_created !== true ||
    data.raw_token_available !== true
  ) {
    throw new Error("résultat d'ouverture incohérent");
  }

  const { data: persisted, error: persistedError } = await admin
    .from("creance")
    .select("etat, ready_for_collection_at")
    .eq("id", creance.id)
    .single();
  if (persistedError) throw persistedError;
  if (persisted.etat !== "OUVERTE" || !persisted.ready_for_collection_at) {
    throw new Error("créance non ouverte");
  }

  const { data: audits, error: auditError } = await admin
    .from("audit_log")
    .select("action, metadata")
    .eq("entity_id", creance.id)
    .in("action", ["PAYMENT_RECEIVABLE_OPENED", "PAYMENT_LINK_CREATED"]);
  if (auditError) throw auditError;
  const actions = new Set((audits ?? []).map((row) => row.action));
  if (!actions.has("PAYMENT_RECEIVABLE_OPENED") || !actions.has("PAYMENT_LINK_CREATED")) {
    throw new Error("audits d'ouverture incomplets");
  }
  if (JSON.stringify(audits).includes(data.raw_token)) {
    throw new Error("token brut présent dans l'audit");
  }
});

await run("idempotence OUVERTE, timestamp stable et token irrécupérable", async () => {
  const { creance } = await createDraft(tenantA.client, "idempotence");
  const first = await tenantA.client.rpc("open_payment_receivable", {
    p_creance_id: creance.id,
  });
  if (first.error || !first.data?.raw_token) {
    throw first.error ?? new Error("première ouverture invalide");
  }
  const second = await tenantA.client.rpc("open_payment_receivable", {
    p_creance_id: creance.id,
  });
  if (second.error || !second.data) throw second.error ?? new Error("second résultat absent");
  if (
    second.data.opened !== false ||
    second.data.payment_link_created !== false ||
    second.data.raw_token_available !== false ||
    second.data.raw_token !== null ||
    second.data.result !== "payment_link_already_exists_token_unavailable" ||
    second.data.payment_link_id !== first.data.payment_link_id ||
    second.data.ready_for_collection_at !== first.data.ready_for_collection_at
  ) {
    throw new Error("idempotence ou non-récupération du token violée");
  }

  const { count: activeCount, error: countError } = await admin
    .from("payment_link")
    .select("*", { count: "exact", head: true })
    .eq("creance_id", creance.id)
    .eq("status", "active");
  if (countError || activeCount !== 1) throw countError ?? new Error("lien actif dupliqué");
});

await run("le token est généré côté serveur et seul son SHA-256 est persisté", async () => {
  const { creance } = await createDraft(tenantA.client, "token");
  const { data, error } = await tenantA.client.rpc("open_payment_receivable", {
    p_creance_id: creance.id,
  });
  if (error || !data?.raw_token) throw error ?? new Error("token absent");
  if (!/^[A-Za-z0-9_-]{43}$/.test(data.raw_token)) {
    throw new Error("format ou entropie du token inattendus");
  }

  const expectedHash = createHash("sha256").update(data.raw_token).digest("hex");
  const { data: link, error: linkError } = await admin
    .from("payment_link")
    .select("token_hash")
    .eq("id", data.payment_link_id)
    .single();
  if (linkError) throw linkError;
  if (link.token_hash !== expectedHash || link.token_hash === data.raw_token) {
    throw new Error("persistance du token non conforme");
  }

  const { rows } = await postgres.query(`
    select
      pg_get_function_arguments(p.oid) as arguments,
      pg_get_functiondef(p.oid) like '%gen_random_bytes(32)%' as secure_generation,
      to_regprocedure('public.create_payment_link_for_creance(uuid,text)') is null
        as caller_hash_rpc_absent
    from pg_catalog.pg_proc p
    where p.oid = 'public.open_payment_receivable(uuid)'::regprocedure
  `);
  if (
    rows[0]?.arguments !== "p_creance_id uuid" ||
    !rows[0]?.secure_generation ||
    !rows[0]?.caller_hash_rpc_absent
  ) {
    throw new Error("génération serveur contournable");
  }
});

await run("deux ouvertures concurrentes convergent vers un seul lien", async () => {
  const { creance } = await createDraft(tenantA.client, "concurrence");
  const calls = await Promise.all([
    tenantA.client.rpc("open_payment_receivable", { p_creance_id: creance.id }),
    tenantA.client.rpc("open_payment_receivable", { p_creance_id: creance.id }),
  ]);
  if (calls.some((call) => call.error || !call.data)) {
    throw calls.find((call) => call.error)?.error ?? new Error("appel concurrent refusé");
  }
  if (calls[0].data.payment_link_id !== calls[1].data.payment_link_id) {
    throw new Error("les appels n'ont pas convergé");
  }
  if (calls.filter((call) => call.data.payment_link_created).length !== 1) {
    throw new Error("nombre de créations concurrentes inattendu");
  }
  if (calls.filter((call) => call.data.raw_token_available).length !== 1) {
    throw new Error("token brut émis plus d'une fois");
  }
});

await run("cross-tenant, archivées et états non payables sont refusés", async () => {
  const tenantB = await createUserAndClient("stripe-002-b");
  const foreign = await createDraft(tenantA.client, "foreign");
  const crossTenant = await tenantB.client.rpc("open_payment_receivable", {
    p_creance_id: foreign.creance.id,
  });
  if (!crossTenant.error || !/creance_not_found/.test(crossTenant.error.message)) {
    throw new Error("ouverture cross-tenant non refusée génériquement");
  }

  const archived = await createDraft(tenantA.client, "archived");
  const archiveResult = await tenantA.client.rpc("archive_current_creance", {
    p_id: archived.creance.id,
  });
  if (archiveResult.error) throw archiveResult.error;
  const archivedOpen = await tenantA.client.rpc("open_payment_receivable", {
    p_creance_id: archived.creance.id,
  });
  if (!archivedOpen.error || !/payment_receivable_archived/.test(archivedOpen.error.message)) {
    throw new Error("créance archivée non refusée");
  }

  for (const state of [
    "PARTIELLEMENT_REGLEE",
    "REGLEE",
    "EN_LITIGE",
    "ANNULEE",
    "IRRECOUVRABLE",
  ]) {
    const candidate = await createDraft(tenantA.client, `state-${state}`);
    const { error: updateError } = await admin
      .from("creance")
      .update({ etat: state })
      .eq("id", candidate.creance.id);
    if (updateError) throw updateError;
    const refused = await tenantA.client.rpc("open_payment_receivable", {
      p_creance_id: candidate.creance.id,
    });
    if (!refused.error || !/payment_receivable_not_payable/.test(refused.error.message)) {
      throw new Error(`état non payable accepté: ${state}`);
    }
  }
});

await run("un lien révoqué reste révoqué et n'est jamais réactivé", async () => {
  const { creance } = await createDraft(tenantA.client, "revocation");
  const first = await tenantA.client.rpc("open_payment_receivable", {
    p_creance_id: creance.id,
  });
  if (first.error || !first.data) throw first.error ?? new Error("premier lien absent");
  const revoked = await admin.rpc("revoke_payment_link", {
    p_payment_link_id: first.data.payment_link_id,
  });
  if (revoked.error || revoked.data?.status !== "revoked") {
    throw revoked.error ?? new Error("révocation absente");
  }

  const directReactivation = await admin
    .from("payment_link")
    .update({ status: "active", revoked_at: null })
    .eq("id", first.data.payment_link_id);
  if (!directReactivation.error) throw new Error("réactivation directe autorisée");

  const replacement = await tenantA.client.rpc("open_payment_receivable", {
    p_creance_id: creance.id,
  });
  if (
    replacement.error ||
    !replacement.data?.payment_link_created ||
    replacement.data.payment_link_id === first.data.payment_link_id
  ) {
    throw replacement.error ?? new Error("nouveau lien explicite absent");
  }
  const { data: oldLink, error: oldLinkError } = await admin
    .from("payment_link")
    .select("status, revoked_at")
    .eq("id", first.data.payment_link_id)
    .single();
  if (oldLinkError || oldLink.status !== "revoked" || !oldLink.revoked_at) {
    throw oldLinkError ?? new Error("ancien lien réactivé");
  }
});

await run("une seule tentative non terminale, puis nouvelle tentative terminalisée", async () => {
  const { creance } = await createDraft(tenantA.client, "tentative");
  const opened = await tenantA.client.rpc("open_payment_receivable", {
    p_creance_id: creance.id,
  });
  if (opened.error || !opened.data) throw opened.error ?? new Error("lien absent");

  const operationKey = randomUUID();
  const idempotencyKey = `sidian_checkout_${randomUUID()}`;
  const { data: first, error: firstError } = await admin
    .from("tentative_paiement")
    .insert({
      creance_id: creance.id,
      payment_link_id: opened.data.payment_link_id,
      montant: 12000,
      moyen: null,
      source: "lien_agent",
      checkout_operation_key: operationKey,
      stripe_checkout_idempotency_key: idempotencyKey,
      etat: "CREEE",
    })
    .select("id, moyen")
    .single();
  if (firstError || !first || first.moyen !== null) {
    throw firstError ?? new Error("tentative CREEE sans moyen refusée");
  }

  const concurrent = await admin.from("tentative_paiement").insert({
    creance_id: creance.id,
    payment_link_id: opened.data.payment_link_id,
    montant: 12000,
    moyen: null,
    source: "lien_agent",
    checkout_operation_key: randomUUID(),
    stripe_checkout_idempotency_key: `sidian_checkout_${randomUUID()}`,
    etat: "EN_TRAITEMENT",
  });
  if (!concurrent.error) throw new Error("deux tentatives non terminales autorisées");

  const { error: terminalError } = await admin
    .from("tentative_paiement")
    .update({ etat: "ECHOUEE" })
    .eq("id", first.id);
  if (terminalError) throw terminalError;

  const next = await admin.from("tentative_paiement").insert({
    creance_id: creance.id,
    payment_link_id: opened.data.payment_link_id,
    montant: 12000,
    moyen: null,
    source: "lien_agent",
    checkout_operation_key: randomUUID(),
    stripe_checkout_idempotency_key: `sidian_checkout_${randomUUID()}`,
    etat: "CREEE",
  });
  if (next.error) throw next.error;
});

await run("unicités techniques, scope lien et contraintes de provisioning", async () => {
  const firstDraft = await createDraft(tenantA.client, "tech-1");
  const secondDraft = await createDraft(tenantA.client, "tech-2");
  const firstOpen = await tenantA.client.rpc("open_payment_receivable", {
    p_creance_id: firstDraft.creance.id,
  });
  const secondOpen = await tenantA.client.rpc("open_payment_receivable", {
    p_creance_id: secondDraft.creance.id,
  });
  if (firstOpen.error || secondOpen.error) throw firstOpen.error ?? secondOpen.error;

  const operationKey = randomUUID();
  const idempotencyKey = `sidian_checkout_${randomUUID()}`;
  const sessionId = `cs_test_${randomUUID()}`;
  const intentId = `pi_test_${randomUUID()}`;
  const { error: seedError } = await admin.from("tentative_paiement").insert({
    creance_id: firstDraft.creance.id,
    payment_link_id: firstOpen.data.payment_link_id,
    montant: 12000,
    moyen: "carte",
    source: "lien_agent",
    checkout_operation_key: operationKey,
    stripe_checkout_idempotency_key: idempotencyKey,
    stripe_checkout_session_id: sessionId,
    stripe_payment_intent_id: intentId,
    stripe_account_id: "acct_snapshot",
    stripe_customer_id: "cus_snapshot",
    application_fee_amount: 0,
    etat: "ECHOUEE",
  });
  if (seedError) throw seedError;

  for (const duplicate of [
    { checkout_operation_key: operationKey },
    { stripe_checkout_idempotency_key: idempotencyKey },
    { stripe_checkout_session_id: sessionId },
    { stripe_payment_intent_id: intentId },
  ]) {
    const attempt = await admin.from("tentative_paiement").insert({
      creance_id: secondDraft.creance.id,
      payment_link_id: secondOpen.data.payment_link_id,
      montant: 12000,
      moyen: null,
      source: "lien_agent",
      etat: "ECHOUEE",
      ...duplicate,
    });
    if (!attempt.error) throw new Error("unicité technique contournée");
  }

  const linkMismatch = await admin.from("tentative_paiement").insert({
    creance_id: secondDraft.creance.id,
    payment_link_id: firstOpen.data.payment_link_id,
    montant: 12000,
    moyen: null,
    source: "lien_agent",
    etat: "ECHOUEE",
  });
  if (!linkMismatch.error) throw new Error("lien d'une autre créance accepté");

  const missingLease = await admin.from("tentative_paiement").insert({
    creance_id: secondDraft.creance.id,
    payment_link_id: secondOpen.data.payment_link_id,
    montant: 12000,
    moyen: null,
    source: "lien_agent",
    etat: "ECHOUEE",
    checkout_provisioning_status: "creating",
  });
  if (!missingLease.error) throw new Error("provisioning creating sans lease accepté");

  const invalidValues = await admin.from("tentative_paiement").insert({
    creance_id: secondDraft.creance.id,
    payment_link_id: secondOpen.data.payment_link_id,
    montant: 12000,
    moyen: null,
    source: "lien_agent",
    etat: "ECHOUEE",
    stripe_account_id: " ",
    application_fee_amount: -1,
  });
  if (!invalidValues.error) throw new Error("snapshot vide ou commission négative accepté");
});

await run("ACL et RLS du rate limiting sont privés", async () => {
  const signature =
    "public.consume_public_rate_limit(public.public_rate_limit_category,text)";
  const { rows } = await postgres.query(
    `select
      has_function_privilege('service_role', $1, 'EXECUTE') as service_execute,
      has_function_privilege('authenticated', $1, 'EXECUTE') as auth_execute,
      has_function_privilege('anon', $1, 'EXECUTE') as anon_execute,
      has_function_privilege('public', $1, 'EXECUTE') as public_execute,
      has_table_privilege('service_role', 'public.public_rate_limit_event', 'SELECT')
        as service_select,
      has_table_privilege('service_role', 'public.public_rate_limit_event', 'INSERT')
        as service_insert,
      has_table_privilege('authenticated', 'public.public_rate_limit_event', 'SELECT')
        as auth_select,
      has_table_privilege('anon', 'public.public_rate_limit_event', 'SELECT')
        as anon_select,
      (select relrowsecurity from pg_catalog.pg_class
        where oid = 'public.public_rate_limit_event'::regclass) as rls_enabled`,
    [signature],
  );
  const acl = rows[0];
  if (
    !acl.service_execute ||
    acl.auth_execute ||
    acl.anon_execute ||
    acl.public_execute ||
    acl.service_select ||
    acl.service_insert ||
    acl.auth_select ||
    acl.anon_select ||
    !acl.rls_enabled
  ) {
    throw new Error("ACL rate limiting inattendues");
  }

  const anonCall = await anon.rpc("consume_public_rate_limit", {
    p_category: "link_resolution_ip",
    p_subject_hash: subjectHash("anon", randomUUID()),
  });
  if (!anonCall.error) throw new Error("anon peut consommer le quota");
  const authCall = await tenantA.client.rpc("consume_public_rate_limit", {
    p_category: "link_resolution_ip",
    p_subject_hash: subjectHash("authenticated", randomUUID()),
  });
  if (!authCall.error) throw new Error("authenticated peut consommer le quota");
});

await run("quota atomique et seuils fixes", async () => {
  const hash = subjectHash("resolution-ip", randomUUID());
  const calls = await Promise.all(
    Array.from({ length: 31 }, () =>
      admin.rpc("consume_public_rate_limit", {
        p_category: "link_resolution_ip",
        p_subject_hash: hash,
      }),
    ),
  );
  if (calls.some((call) => call.error || !call.data)) {
    throw calls.find((call) => call.error)?.error ?? new Error("quota inaccessible");
  }
  const allowed = calls.filter((call) => call.data.allowed).length;
  const denied = calls.filter((call) => !call.data.allowed).length;
  if (allowed !== 30 || denied !== 1) {
    throw new Error(`décision atomique inattendue: ${allowed}/${denied}`);
  }

  for (const [category, limit] of [
    ["link_resolution_token", 60],
    ["checkout_creation_ip", 5],
    ["checkout_new_operation_link", 3],
  ]) {
    const categoryHash = subjectHash(category, randomUUID());
    const categoryCalls = [];
    for (let index = 0; index < limit + 1; index += 1) {
      categoryCalls.push(
        await admin.rpc("consume_public_rate_limit", {
          p_category: category,
          p_subject_hash: categoryHash,
        }),
      );
    }
    if (
      categoryCalls.slice(0, limit).some((call) => call.error || !call.data.allowed) ||
      categoryCalls.at(-1).error ||
      categoryCalls.at(-1).data.allowed
    ) {
      throw new Error(`seuil incorrect pour ${category}`);
    }
  }
});

await run("catégories et sujets sont isolés sans données brutes persistées", async () => {
  const rawIp = "203.0.113.42";
  const rawToken = `local-test-token-${randomUUID()}`;
  const ipHash = subjectHash(`trusted-ip-${randomUUID()}`, rawIp);
  const tokenHash = subjectHash("public-token", rawToken);

  const firstIp = await admin.rpc("consume_public_rate_limit", {
    p_category: "link_resolution_ip",
    p_subject_hash: ipHash,
  });
  const sameHashOtherCategory = await admin.rpc("consume_public_rate_limit", {
    p_category: "checkout_creation_ip",
    p_subject_hash: ipHash,
  });
  const otherSubject = await admin.rpc("consume_public_rate_limit", {
    p_category: "link_resolution_ip",
    p_subject_hash: tokenHash,
  });
  if (
    firstIp.error ||
    sameHashOtherCategory.error ||
    otherSubject.error ||
    firstIp.data.remaining !== 29 ||
    sameHashOtherCategory.data.remaining !== 4 ||
    otherSubject.data.remaining !== 29
  ) {
    throw new Error("séparation catégorie/sujet incorrecte");
  }

  const { rows } = await postgres.query(
    `select subject_hash
     from public.public_rate_limit_event
     where subject_hash in ($1, $2)`,
    [ipHash, tokenHash],
  );
  if (rows.length !== 3 || rows.some((row) => row.subject_hash === rawIp || row.subject_hash === rawToken)) {
    throw new Error("donnée brute persistée ou pseudonymes absents");
  }
  const { rows: rawRows } = await postgres.query(
    `select count(*)::integer as count
     from public.public_rate_limit_event
     where subject_hash in ($1, $2)`,
    [rawIp, rawToken],
  );
  if (rawRows[0].count !== 0) throw new Error("IP ou token brut persisté");
});

await run("les événements expirés sont purgeables par lot", async () => {
  const expiredHash = subjectHash("expired", randomUUID());
  await postgres.query(
    `insert into public.public_rate_limit_event (
       category, subject_hash, occurred_at, expires_at
     ) values (
       'link_resolution_ip', $1,
       timezone('utc', now()) - interval '20 minutes',
       timezone('utc', now()) - interval '10 minutes'
     )`,
    [expiredHash],
  );
  const purged = await admin.rpc("purge_expired_public_rate_limits", {
    p_batch_size: 100,
  });
  if (purged.error || purged.data < 1) {
    throw purged.error ?? new Error("aucun événement purgé");
  }
  const { rows } = await postgres.query(
    `select count(*)::integer as count
     from public.public_rate_limit_event
     where subject_hash = $1`,
    [expiredHash],
  );
  if (rows[0].count !== 0) throw new Error("événement expiré encore présent");
});

await postgres.end();

const failures = results.filter((result) => !result.ok);
console.log(`\nSID-STRIPE-002-A: ${results.length - failures.length}/${results.length} tests réussis.`);
if (failures.length > 0) process.exitCode = 1;
