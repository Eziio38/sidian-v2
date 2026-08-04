#!/usr/bin/env node
/**
 * SID-RUNTIME-002 — consommateur `runtime_job` contre une base réelle.
 *
 * Les tests unitaires du dispatcher s'appuient sur un dépôt mémoire. Ce
 * harnais vérifie que le SQL se comporte comme ce dépôt le prétend : fencing
 * par lease, backoff, plafond de tentatives, relâchement sans consommation, et
 * clôture de dossier idempotente.
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

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`✓ ${message}`);
}

async function rpc(name, args) {
  const { data, error } = await admin.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
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

const iso = (offsetSeconds = 0) =>
  new Date(Date.parse("2026-08-03T10:00:00.000Z") + offsetSeconds * 1000)
    .toISOString();

async function main() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `runtime-${suffix}@sidian.test`;

  const { data: userData, error: userError } =
    await admin.auth.admin.createUser({
      email,
      password: "RuntimeTest123!",
      email_confirm: true,
    });
  if (userError) throw userError;

  const prestataire = await insertOne("prestataire", {
    user_id: userData.user.id,
    nom: "Runtime",
    email,
  });
  const client = await insertOne("client_payeur", {
    prestataire_id: prestataire.id,
    nom: "Client Runtime",
    email: `client-${suffix}@exemple.test`,
  });

  async function newCreance(etat) {
    return insertOne("creance", {
      prestataire_id: prestataire.id,
      client_payeur_id: client.id,
      montant: 10_000,
      devise: "EUR",
      date_echeance: "2026-07-01",
      etat,
      origine: "import_manuel",
    });
  }

  async function enqueue(creanceId, key, jobKind = "closure_close_dossier") {
    return rpc("enqueue_runtime_job", {
      p_prestataire_id: prestataire.id,
      p_creance_id: creanceId,
      p_dossier_suivi_id: null,
      p_scanner_kind: "closure",
      p_job_kind: jobKind,
      p_policy_version: "2026-07-26.v1",
      p_idempotency_key: key,
      p_payload: {},
      p_available_at: iso(),
      p_now: iso(),
    });
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

  // ── Idempotence de l'enfilement ──────────────────────────────────────────
  const creance1 = await newCreance("REGLEE");
  const first = await enqueue(creance1.id, `rt-${suffix}-1`);
  const dup = await enqueue(creance1.id, `rt-${suffix}-1`);
  check(first.enqueued === true, "un job s'enfile");
  check(
    dup.enqueued === false && dup.duplicate === true && dup.job_id === first.job_id,
    "la même clé d'idempotence ne crée pas de doublon",
  );

  // ── Claim, fencing, acquittement ─────────────────────────────────────────
  const claimed = await rpc("claim_runtime_jobs", {
    p_now: iso(),
    p_lease_seconds: 120,
    p_batch_size: 10,
    p_job_kinds: ["closure_close_dossier"],
  });
  check(claimed.length === 1, "le claim filtre bien sur le type de job");
  const job = claimed[0];
  check(job.attempt_count === 1, "le claim consomme une tentative");

  const wrongToken = await rpc("complete_runtime_job", {
    p_job_id: job.id,
    p_lease_token: "00000000-0000-0000-0000-000000000000",
    p_now: iso(1),
  });
  check(wrongToken === false, "un mauvais jeton de lease ne peut pas acquitter");

  const expired = await rpc("complete_runtime_job", {
    p_job_id: job.id,
    p_lease_token: job.lease_token,
    p_now: iso(10_000),
  });
  check(expired === false, "un lease expiré ne peut plus acquitter");

  const ok = await rpc("complete_runtime_job", {
    p_job_id: job.id,
    p_lease_token: job.lease_token,
    p_now: iso(5),
  });
  check(ok === true, "le détenteur du lease acquitte le job");
  const completed = await readJob(job.id);
  check(
    completed.status === "completed" && completed.completed_at !== null,
    "le job acquitté est marqué completed",
  );

  const reclaim = await rpc("claim_runtime_jobs", {
    p_now: iso(20),
    p_lease_seconds: 120,
    p_batch_size: 10,
    p_job_kinds: ["closure_close_dossier"],
  });
  check(reclaim.length === 0, "un job acquitté n'est jamais re-claimé");

  // ── Backoff et échec terminal ────────────────────────────────────────────
  const creance2 = await newCreance("REGLEE");
  await enqueue(creance2.id, `rt-${suffix}-2`);

  const delays = [];
  let now = 100;
  let terminal = null;
  for (let i = 0; i < 6; i += 1) {
    const batch = await rpc("claim_runtime_jobs", {
      p_now: iso(now),
      p_lease_seconds: 120,
      p_batch_size: 10,
      p_job_kinds: ["closure_close_dossier"],
    });
    if (batch.length === 0) break;
    const outcome = await rpc("fail_runtime_job", {
      p_job_id: batch[0].id,
      p_lease_token: batch[0].lease_token,
      p_error_code: "boom",
      p_retryable: true,
      p_max_attempts: 3,
      p_backoff_base_seconds: 60,
      p_now: iso(now + 1),
    });
    if (outcome === "failed_terminal") {
      terminal = batch[0].id;
      break;
    }
    const row = await readJob(batch[0].id);
    delays.push(Math.round((Date.parse(row.available_at) - Date.parse(iso(now + 1))) / 1000));
    now = Math.round((Date.parse(row.available_at) - Date.parse(iso(0))) / 1000);
  }
  check(
    delays[0] === 60 && delays[1] === 120,
    `backoff exponentiel appliqué (${delays.slice(0, 2).join(", ")}s)`,
  );
  check(Boolean(terminal), "le job sort en échec terminal au plafond");
  const terminalRow = await readJob(terminal);
  check(
    terminalRow.status === "failed_terminal" && terminalRow.last_error_code === "boom",
    "l'échec terminal conserve le code d'erreur",
  );

  // ── Relâchement sans consommation de tentative ───────────────────────────
  const creance3 = await newCreance("REGLEE");
  await enqueue(creance3.id, `rt-${suffix}-3`);
  const toRelease = (
    await rpc("claim_runtime_jobs", {
      p_now: iso(9_000),
      p_lease_seconds: 120,
      p_batch_size: 10,
      p_job_kinds: ["closure_close_dossier"],
    })
  )[0];
  check(toRelease.attempt_count === 1, "le claim a bien incrémenté");

  const released = await rpc("release_runtime_job", {
    p_job_id: toRelease.id,
    p_lease_token: toRelease.lease_token,
    p_now: iso(9_001),
  });
  const releasedRow = await readJob(toRelease.id);
  check(released === true, "un job claimé peut être rendu au pool");
  check(
    releasedRow.status === "pending" && releasedRow.attempt_count === 0,
    "le relâchement rend la tentative non consommée",
  );

  // ── Plafond de tentatives : le claim cesse d'être éligible ───────────────
  await admin
    .from("runtime_job")
    .update({ attempt_count: 32, status: "pending" })
    .eq("id", toRelease.id);
  const capped = await rpc("claim_runtime_jobs", {
    p_now: iso(9_100),
    p_lease_seconds: 120,
    p_batch_size: 10,
    p_job_kinds: ["closure_close_dossier"],
  });
  check(
    !capped.some((row) => row.id === toRelease.id),
    "au plafond de tentatives, le job cesse d'être claimé au lieu de casser le lot",
  );
  await admin.from("runtime_job").delete().eq("id", toRelease.id);

  // ── runtime_close_dossier ────────────────────────────────────────────────
  const creanceActive = await newCreance("OUVERTE");
  const notTerminal = await rpc("runtime_close_dossier", {
    p_creance_id: creanceActive.id,
    p_now: iso(),
  });
  check(
    notTerminal === "creance_not_terminal",
    "une créance active ne peut pas voir son dossier clos automatiquement",
  );

  const creance4 = await newCreance("REGLEE");
  const closed = await rpc("runtime_close_dossier", {
    p_creance_id: creance4.id,
    p_now: iso(),
  });
  check(closed === "closed", "une créance terminale entraîne la clôture");

  const again = await rpc("runtime_close_dossier", {
    p_creance_id: creance4.id,
    p_now: iso(60),
  });
  check(
    again === "already_closed",
    "rejouer la clôture est idempotent, jamais une erreur",
  );

  const { data: dossier } = await admin
    .from("dossier_suivi")
    .select("etat, clos_at")
    .eq("creance_id", creance4.id)
    .single();
  check(
    dossier.etat === "CLOS" && dossier.clos_at !== null,
    "le dossier est réellement clos en base",
  );

  const { data: auditRows } = await admin
    .from("audit_log")
    .select("id, action, actor_type")
    .eq("prestataire_id", prestataire.id)
    .eq("action", "dossier_suivi.closed_by_runtime");
  check(
    (auditRows ?? []).length === 1,
    "la clôture est tracée une seule fois dans audit_log",
  );
  check(
    auditRows[0].actor_type === "system",
    "la clôture automatique est attribuée au système, pas à un humain",
  );

  const missing = await rpc("runtime_close_dossier", {
    p_creance_id: "00000000-0000-0000-0000-000000000000",
    p_now: iso(),
  });
  check(missing === "creance_not_found", "une créance inexistante est signalée");

  // ── Backlog ──────────────────────────────────────────────────────────────
  const creance5 = await newCreance("REGLEE");
  await enqueue(creance5.id, `rt-${suffix}-5`, "prevention_notice");
  const backlog = await rpc("runtime_job_backlog", { p_now: iso(10_000) });
  check(
    (backlog ?? []).some(
      (row) => row.job_kind === "prevention_notice" && Number(row.total) >= 1,
    ),
    "le backlog expose les types sans consommateur",
  );

  const unwiredClaim = await rpc("claim_runtime_jobs", {
    p_now: iso(10_000),
    p_lease_seconds: 120,
    p_batch_size: 10,
    p_job_kinds: ["closure_close_dossier"],
  });
  check(
    !unwiredClaim.some((row) => row.job_kind === "prevention_notice"),
    "un type non demandé n'est jamais claimé par erreur",
  );

  // ── Frontières de rôle ───────────────────────────────────────────────────
  const anon = createClient(
    localConfig.url,
    LOCAL_DEMO_ANON_KEY,
    withLocalOnlyFetch({
      auth: { autoRefreshToken: false, persistSession: false },
    }),
  );
  const { error: anonError } = await anon.rpc("claim_runtime_jobs", {
    p_now: iso(),
    p_lease_seconds: 120,
    p_batch_size: 1,
  });
  check(Boolean(anonError), "anon ne peut pas claimer de job runtime");

  const { data: anonRows } = await anon.from("runtime_job").select("id");
  check((anonRows ?? []).length === 0, "anon ne lit aucune ligne runtime_job");

  console.log(`\nSID-RUNTIME-002 : ${passed}/${passed} tests réussis.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
