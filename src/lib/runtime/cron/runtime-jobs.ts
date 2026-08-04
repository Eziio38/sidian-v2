/**
 * Drain borné de `runtime_job` — le consommateur des intentions produites par
 * les scanners. Uniquement via cron authentifié.
 *
 * Deux familles d'effets y transitent :
 * - la clôture de dossier, effet entièrement interne ;
 * - les relances, qui enfilent un email dans l'outbox (jamais d'appel réseau
 *   ici : la livraison reste le travail du drain email).
 *
 * Le canal email est résolu une fois par exécution. S'il est désactivé ou mal
 * configuré, les handlers de relance échouent avec un code explicite plutôt
 * que d'acquitter un envoi qui n'a pas eu lieu ; la clôture continue de
 * passer. `autopay_intent` reste non câblé et remonte dans `unwired`.
 */

import "server-only";

import { logServerEvent } from "@/lib/observability/server-logger";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  DEFAULT_RUNTIME_JOB_LEASE_SECONDS,
  dispatchRuntimeJobs,
  createSupabaseRuntimeJobRepository,
} from "../jobs";
import { createRelanceMailerFromEnv } from "../jobs/handlers/mailer-from-env";
import type { Deadline } from "./deadline";
import type { RuntimeJobsDrainSummary } from "./types";

const DEFAULT_RUNTIME_JOB_BATCH = 25;
const MAX_RUNTIME_JOB_BATCH = 50;

function emptySummary(
  status: RuntimeJobsDrainSummary["status"],
  reasonCode?: string,
): RuntimeJobsDrainSummary {
  return {
    status,
    reasonCode,
    claimed: 0,
    completed: 0,
    retryable: 0,
    terminal: 0,
    leaseLost: 0,
    unwired: [],
    durationMs: 0,
  };
}

export type RunRuntimeJobsDrainInput = {
  requestId: string;
  limit?: number;
  deadline?: Deadline;
};

export async function runRuntimeJobsDrain(
  input: RunRuntimeJobsDrainInput,
): Promise<RuntimeJobsDrainSummary> {
  const started = Date.now();

  if (input.deadline?.isExpired()) {
    return emptySummary("deadline_reached", "deadline_before_start");
  }

  const batchSize = Math.min(
    MAX_RUNTIME_JOB_BATCH,
    Math.max(1, Math.trunc(input.limit ?? DEFAULT_RUNTIME_JOB_BATCH)),
  );

  try {
    // service_role : les RPC runtime_job ne sont accessibles qu'à ce rôle.
    const client = await createAdminClient();
    const repository = createSupabaseRuntimeJobRepository(client);
    // Ne lève jamais : un canal indisponible produit un mailer qui le dit.
    const mailer = await createRelanceMailerFromEnv();

    const result = await dispatchRuntimeJobs({
      repository,
      mailer,
      batchSize,
      leaseSeconds: DEFAULT_RUNTIME_JOB_LEASE_SECONDS,
      now: () => new Date(),
      isDeadlineExpired: () => input.deadline?.isExpired() ?? false,
    });

    const durationMs = Math.max(0, Date.now() - started);
    const deadlineHit = input.deadline?.isExpired() ?? false;
    const status: RuntimeJobsDrainSummary["status"] = deadlineHit
      ? "deadline_reached"
      : result.terminal > 0
        ? "partial"
        : "completed";

    for (const entry of result.unwired) {
      // Un type sans consommateur qui grossit est un signal d'exploitation,
      // pas une erreur : il est journalisé en warn, sans faire échouer le cron.
      logServerEvent("warn", "outbox_failed", {
        requestId: input.requestId,
        job: "runtime_jobs",
        jobKind: entry.jobKind,
        pending: entry.pending,
        reasonCode: "job_kind_without_consumer",
      });
    }

    logServerEvent(result.terminal > 0 ? "warn" : "info", "outbox_sent", {
      requestId: input.requestId,
      job: "runtime_jobs",
      claimed: result.claimed,
      completed: result.completed,
      retryable: result.retryable,
      terminal: result.terminal,
      leaseLost: result.leaseLost,
      unwiredKinds: result.unwired.length,
      durationMs,
    });

    return {
      status,
      claimed: result.claimed,
      completed: result.completed,
      retryable: result.retryable,
      terminal: result.terminal,
      leaseLost: result.leaseLost,
      unwired: result.unwired,
      durationMs,
    };
  } catch (error) {
    const reasonCode =
      error instanceof Error
        ? error.message.slice(0, 80)
        : "runtime_jobs_drain_failed";
    logServerEvent("error", "outbox_failed", {
      requestId: input.requestId,
      job: "runtime_jobs",
      reasonCode,
    });
    return {
      ...emptySummary("failed", reasonCode),
      durationMs: Math.max(0, Date.now() - started),
    };
  }
}
