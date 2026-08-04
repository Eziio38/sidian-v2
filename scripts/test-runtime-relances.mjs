#!/usr/bin/env node
/**
 * SID-RUNTIME-RELANCES — la chaîne job → email, contre une base réelle.
 *
 * Les tests du dispatcher s'appuient sur un dépôt mémoire. Ce harnais exécute
 * les *vrais* handlers, le *vrai* dépôt Supabase et le *vrai* canal email
 * contre la base locale : chargement du contexte, un email enfilé par type de
 * relance, rejeu sans second envoi, canal désactivé sans faux succès, et
 * cloisonnement des tenants.
 *
 * Aucun appel réseau sortant : l'outbox n'est qu'une intention persistée, la
 * livraison reste le travail du drain email.
 *
 * Lancement : node --experimental-strip-types scripts/test-runtime-relances.mjs
 */

import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

import { createClient } from "@supabase/supabase-js";

import {
  assertLocalTestConfig,
  LOCAL_DEMO_ANON_KEY,
  LOCAL_DEMO_SERVICE_ROLE_KEY,
} from "./lib/assert-local-supabase.mjs";
import { withLocalOnlyFetch } from "./lib/local-only-fetch.mjs";

// ── Résolution des modules applicatifs ──────────────────────────────────────
//
// Le code produit est écrit pour le bundler Next (imports sans extension,
// alias `@/`, marqueur `server-only`). Node ne connaît rien de tout cela. On
// enseigne ces trois conventions au résolveur plutôt que de réécrire dans le
// harnais une copie de la logique testée — une copie ne prouverait rien.

const SRC_URL = pathToFileURL(new URL("../src/", import.meta.url).pathname).href;

function resolveWithExtensions(specifier, context, nextResolve) {
  const candidates = [specifier, `${specifier}.ts`, `${specifier}/index.ts`];
  for (const candidate of candidates) {
    try {
      return nextResolve(candidate, context);
    } catch {
      // Candidat suivant.
    }
  }
  throw new Error(`module_introuvable:${specifier}`);
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // `server-only` n'est qu'un garde-fou de bundle : ici on EST le serveur.
    if (specifier === "server-only") {
      return { url: "data:text/javascript,", shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      return resolveWithExtensions(
        `${SRC_URL}${specifier.slice(2)}`,
        context,
        nextResolve,
      );
    }
    if (specifier.startsWith(".")) {
      return resolveWithExtensions(specifier, context, nextResolve);
    }
    return nextResolve(specifier, context);
  },
});

const { dispatchRuntimeJobs } = await import(
  "../src/lib/runtime/jobs/dispatcher.ts"
);
const { createSupabaseRuntimeJobRepository } = await import(
  "../src/lib/runtime/jobs/supabase-repository.ts"
);
const { createRelanceMailer } = await import(
  "../src/lib/runtime/jobs/handlers/mailer.ts"
);
const { buildRelanceEmailIdempotencyKey, RELANCE_ERROR_CODES } = await import(
  "../src/lib/runtime/jobs/handlers/relance.ts"
);
const { createSupabaseEmailOutboxRepository } = await import(
  "../src/lib/email/outbox/supabase-repository.ts"
);

// ── Cibles locales strictes ─────────────────────────────────────────────────

const localConfig = assertLocalTestConfig();
const admin = createClient(
  localConfig.url,
  LOCAL_DEMO_SERVICE_ROLE_KEY,
  withLocalOnlyFetch({
    auth: { autoRefreshToken: false, persistSession: false },
  }),
);

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`✓ ${message}`);
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

const repository = createSupabaseRuntimeJobRepository(admin);
const outbox = createSupabaseEmailOutboxRepository(admin);

/** Transport local : rend et persiste, sans appel réseau sortant. */
const STUB_EMAIL_ENV = {
  enabled: true,
  mode: "stub",
  httpTimeoutMs: 8_000,
};
const DISABLED_EMAIL_ENV = {
  enabled: false,
  mode: "disabled",
  httpTimeoutMs: 8_000,
};

const stubMailer = createRelanceMailer({ env: STUB_EMAIL_ENV, outbox });
const disabledMailer = createRelanceMailer({ env: DISABLED_EMAIL_ENV, outbox });

/**
 * Les jobs du harnais sont datés loin dans le passé : le claim ordonne par
 * `available_at`, ils passent donc avant tout backlog laissé par un autre
 * script. Sans cela, l'assertion dépendrait de l'état partagé de la base.
 */
const PAST = "2020-01-01T00:00:00.000Z";

async function createTenant(suffix, label) {
  const email = `relance-${label}-${suffix}@sidian.test`;
  const { data: userData, error: userError } =
    await admin.auth.admin.createUser({
      email,
      password: "RelanceTest123!",
      email_confirm: true,
    });
  if (userError) throw userError;

  const prestataire = await insertOne("prestataire", {
    user_id: userData.user.id,
    nom: `Atelier ${label}`,
    email,
  });
  const client = await insertOne(
    "client_payeur",
    {
      prestataire_id: prestataire.id,
      nom: `Client ${label}`,
      email: `client-${label}-${suffix}@exemple.test`,
    },
    "id, nom, email",
  );
  return { prestataire, client };
}

async function readJob(id) {
  const { data, error } = await admin
    .from("runtime_job")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

/** L'outbox canonicalise les adresses (minuscules) avant persistance. */
const canonical = (email) => email.trim().toLowerCase();

async function outboxRowsFor(tenantId, idempotencyKey) {
  const { data, error } = await admin
    .from("email_outbox")
    .select("id, template_key, recipient_email, status, related_entity_id")
    .eq("tenant_id", tenantId)
    .eq("idempotency_key", idempotencyKey);
  if (error) throw error;
  return data ?? [];
}

async function main() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantA = await createTenant(suffix, "A");
  const tenantB = await createTenant(suffix, "B");

  async function newCreance(tenant, overrides = {}) {
    return insertOne("creance", {
      prestataire_id: tenant.prestataire.id,
      client_payeur_id: tenant.client.id,
      montant: 125_000,
      devise: "EUR",
      date_echeance: "2026-08-03",
      etat: "OUVERTE",
      origine: "import_manuel",
      ...overrides,
    });
  }

  /** Enfile un job et renvoie {jobId, idempotencyKey}. */
  async function enqueueJob({ tenant, creanceId, jobKind, scannerKind }) {
    const idempotencyKey = `${jobKind}:${creanceId}:${suffix}`;
    const result = await repository.enqueue({
      prestataireId: tenant.prestataire.id,
      creanceId,
      dossierSuiviId: null,
      scannerKind,
      jobKind,
      policyVersion: "2026-07-26.v1",
      idempotencyKey,
      payload: {},
      availableAt: PAST,
      now: PAST,
    });
    if (!result.enqueued) throw new Error(`enqueue_failed:${jobKind}`);
    return { jobId: result.jobId, idempotencyKey };
  }

  /**
   * Fait tourner le drain jusqu'à traiter le job visé, puis renvoie son item.
   * La base est partagée : on ne suppose jamais que notre job est seul.
   */
  async function dispatchUntil(jobId, mailer) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await dispatchRuntimeJobs({
        repository,
        mailer,
        batchSize: 50,
        now: () => new Date(),
      });
      const item = result.items.find((row) => row.jobId === jobId);
      if (item) return item;
      if (result.claimed === 0) break;
    }
    throw new Error(`job_jamais_traite:${jobId}`);
  }

  // ── 1. Chargement du contexte ─────────────────────────────────────────────
  const creanceA = await newCreance(tenantA);
  const context = await repository.loadJobContext({ creanceId: creanceA.id });

  check(
    context !== null && context.creanceId === creanceA.id,
    "le contexte charge la créance demandée",
  );
  check(
    context.prestataireId === tenantA.prestataire.id &&
      context.prestataireNom === "Atelier A",
    "le contexte tient son périmètre de la créance, jamais d'un identifiant d'appelant",
  );
  check(
    context.clientNom === "Client A" &&
      context.clientEmail === tenantA.client.email,
    "le contexte porte l'identité du client payeur",
  );
  check(
    context.montantCents === 125_000 &&
      context.devise === "EUR" &&
      context.dateEcheance === "2026-08-03" &&
      context.etat === "OUVERTE",
    "le contexte porte montant, devise, échéance et état",
  );
  check(
    context.paymentLinkActive === false && context.paymentLinkId === null,
    "sans lien actif, le contexte le dit",
  );
  check(
    (await repository.loadJobContext({
      creanceId: "00000000-0000-0000-0000-000000000000",
    })) === null,
    "une créance inexistante ne fabrique aucun contexte",
  );

  // ── 2. Lien de paiement : présence connue, URL jamais reconstituable ───────
  const creanceLien = await newCreance(tenantA);
  const linkRow = await insertOne("payment_link", {
    creance_id: creanceLien.id,
    // Empreinte arbitraire : le jeton brut n'existe volontairement nulle part.
    token_hash: `hash-${suffix}-actif`,
    status: "active",
  });
  const withLink = await repository.loadJobContext({
    creanceId: creanceLien.id,
  });
  check(
    withLink.paymentLinkActive === true &&
      withLink.paymentLinkId === linkRow.id,
    "un lien actif est signalé au worker",
  );
  check(
    withLink.paymentLinkUrl === null,
    "l'URL du lien n'est jamais restituée : payment_link ne conserve que le hash du jeton",
  );

  const creanceRevoquee = await newCreance(tenantA);
  await insertOne("payment_link", {
    creance_id: creanceRevoquee.id,
    token_hash: `hash-${suffix}-revoque`,
    status: "revoked",
    revoked_at: new Date().toISOString(),
  });
  const revoked = await repository.loadJobContext({
    creanceId: creanceRevoquee.id,
  });
  check(
    revoked.paymentLinkActive === false,
    "un lien révoqué n'est jamais compté comme actif",
  );

  // ── 3. prevention_notice : un email enfilé, un seul ───────────────────────
  const prevention = await enqueueJob({
    tenant: tenantA,
    creanceId: creanceA.id,
    jobKind: "prevention_notice",
    scannerKind: "prevention",
  });
  const preventionItem = await dispatchUntil(prevention.jobId, stubMailer);
  check(
    preventionItem.outcome === "completed",
    "prevention_notice est acquitté après enfilement de l'email",
  );

  const preventionKey = buildRelanceEmailIdempotencyKey(
    prevention.idempotencyKey,
  );
  const preventionEmails = await outboxRowsFor(
    tenantA.prestataire.id,
    preventionKey,
  );
  check(
    preventionEmails.length === 1,
    "un email exactement est en file pour la relance préventive",
  );
  check(
    preventionEmails[0].template_key === "reminder_before_due" &&
      preventionEmails[0].recipient_email === canonical(tenantA.client.email) &&
      preventionEmails[0].related_entity_id === creanceA.id,
    "l'email préventif vise le bon gabarit, le bon client et la bonne créance",
  );
  check(
    preventionEmails[0].status === "queued",
    "l'email est une intention persistée, jamais un envoi déclaré",
  );

  const { data: rendered } = await admin
    .from("email_outbox")
    .select("subject, body_text, variables_snapshot")
    .eq("id", preventionEmails[0].id)
    .single();
  check(
    rendered.subject.includes("3 août 2026"),
    `la date part en forme longue française (${rendered.subject})`,
  );
  check(
    rendered.subject.includes("€") && rendered.subject.includes("250,00"),
    `le montant part au format monétaire français (${rendered.subject})`,
  );
  check(
    rendered.body_text.includes("Client A") &&
      rendered.body_text.includes("Atelier A"),
    "le corps nomme le client et le prestataire",
  );

  // ── 4. Rejeu : jamais un second envoi ─────────────────────────────────────
  // On remet le job en file comme après une expiration de lease.
  await admin
    .from("runtime_job")
    .update({ status: "pending", attempt_count: 0, completed_at: null })
    .eq("id", prevention.jobId);

  const replayItem = await dispatchUntil(prevention.jobId, stubMailer);
  check(
    replayItem.outcome === "completed",
    "le rejeu d'une relance reste un succès",
  );
  const afterReplay = await outboxRowsFor(
    tenantA.prestataire.id,
    preventionKey,
  );
  check(
    afterReplay.length === 1 && afterReplay[0].id === preventionEmails[0].id,
    "le rejeu retombe sur le même email : jamais deux relances au client",
  );

  // ── 5. retry_failed_notify : notification d'échec de paiement ─────────────
  const creanceEchec = await newCreance(tenantA);
  const retry = await enqueueJob({
    tenant: tenantA,
    creanceId: creanceEchec.id,
    jobKind: "retry_failed_notify",
    scannerKind: "retries",
  });
  const retryItem = await dispatchUntil(retry.jobId, stubMailer);
  const retryEmails = await outboxRowsFor(
    tenantA.prestataire.id,
    buildRelanceEmailIdempotencyKey(retry.idempotencyKey),
  );
  check(
    retryItem.outcome === "completed" &&
      retryEmails.length === 1 &&
      retryEmails[0].template_key === "payment_failed",
    "retry_failed_notify enfile exactement une notification d'échec",
  );

  // ── 6. due_send_link : refus honnête, faute d'URL de lien ─────────────────
  const dueJob = await enqueueJob({
    tenant: tenantA,
    creanceId: creanceLien.id,
    jobKind: "due_send_link",
    scannerKind: "due",
  });
  const dueItem = await dispatchUntil(dueJob.jobId, stubMailer);
  check(
    dueItem.outcome === "terminal" &&
      dueItem.errorCode === RELANCE_ERROR_CODES.paymentLinkUrlUnavailable,
    "due_send_link échoue explicitement plutôt que d'envoyer un message sans le lien qu'il annonce",
  );
  check(
    (
      await outboxRowsFor(
        tenantA.prestataire.id,
        buildRelanceEmailIdempotencyKey(dueJob.idempotencyKey),
      )
    ).length === 0,
    "aucun email n'est enfilé quand la relance d'échéance ne peut pas dire vrai",
  );

  // ── 7. silence_escalate : aucun gabarit ne dit l'escalade ────────────────
  const silenceJob = await enqueueJob({
    tenant: tenantA,
    creanceId: creanceA.id,
    jobKind: "silence_escalate",
    scannerKind: "silence",
  });
  const silenceItem = await dispatchUntil(silenceJob.jobId, stubMailer);
  check(
    silenceItem.outcome === "terminal" &&
      silenceItem.errorCode ===
        RELANCE_ERROR_CODES.escalationTemplateUnavailable,
    "silence_escalate n'envoie rien : aucune escalade maquillée en relance douce",
  );

  // ── 8. Canal désactivé : échec visible, jamais un faux succès ─────────────
  const creanceDesactive = await newCreance(tenantA);
  const disabledJob = await enqueueJob({
    tenant: tenantA,
    creanceId: creanceDesactive.id,
    jobKind: "prevention_notice",
    scannerKind: "prevention",
  });
  const disabledItem = await dispatchUntil(disabledJob.jobId, disabledMailer);
  check(
    disabledItem.outcome === "terminal" &&
      disabledItem.errorCode === "email_provider_disabled",
    "un fournisseur désactivé produit un échec typé, pas un acquittement",
  );
  const disabledRow = await readJob(disabledJob.jobId);
  check(
    disabledRow.status === "failed_terminal" &&
      disabledRow.last_error_code === "email_provider_disabled",
    "la non-délivrance est lisible en base, pas seulement dans les logs",
  );
  check(
    (
      await outboxRowsFor(
        tenantA.prestataire.id,
        buildRelanceEmailIdempotencyKey(disabledJob.idempotencyKey),
      )
    ).length === 0,
    "rien n'est enfilé quand le canal est désactivé : pas de file jamais drainée",
  );

  // ── 9. Cloisonnement : un job de A sur une créance de B n'envoie rien ─────
  const creanceB = await newCreance(tenantB);
  const misScoped = await enqueueJob({
    tenant: tenantA,
    creanceId: creanceB.id,
    jobKind: "prevention_notice",
    scannerKind: "prevention",
  });
  const misScopedItem = await dispatchUntil(misScoped.jobId, stubMailer);
  check(
    misScopedItem.outcome === "terminal" &&
      misScopedItem.errorCode === RELANCE_ERROR_CODES.tenantMismatch,
    "un job de A pointant une créance de B est refusé",
  );

  const { data: leakedRows } = await admin
    .from("email_outbox")
    .select("id")
    .eq("tenant_id", tenantA.prestataire.id)
    .eq("recipient_email", canonical(tenantB.client.email));
  check(
    (leakedRows ?? []).length === 0,
    "l'adresse du client de B n'apparaît dans aucun email attribué à A",
  );

  // ── 10. Frontières de rôle ───────────────────────────────────────────────
  const anon = createClient(
    localConfig.url,
    LOCAL_DEMO_ANON_KEY,
    withLocalOnlyFetch({
      auth: { autoRefreshToken: false, persistSession: false },
    }),
  );
  const { error: anonContextError } = await anon.rpc(
    "runtime_load_job_context",
    { p_creance_id: creanceA.id },
  );
  check(
    Boolean(anonContextError),
    "anon ne peut pas charger le contexte d'une relance",
  );

  const { data: anonOutbox } = await anon.from("email_outbox").select("id");
  check(
    (anonOutbox ?? []).length === 0,
    "anon ne lit aucune ligne d'email_outbox",
  );

  console.log(`\nSID-RUNTIME-RELANCES : ${passed}/${passed} tests réussis.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
