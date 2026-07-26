/**
 * Orchestration drains outbox + payment jobs — batches bornés, soft-deadline.
 */

import "server-only";

import { logServerEvent } from "@/lib/observability/server-logger";

import {
  DEFAULT_DRAIN_BATCH_LIMIT,
  DEFAULT_DRAIN_LEASE_SECONDS,
  runAllActiveDrains,
  type DrainBatchResult,
  type OutboxDrain,
} from "../drains";
import {
  createEmailOutboxDrainFromEnv,
  createNotificationOutboxDrainFromEnv,
  createPaymentConnectAuditOutboxDrainFromEnv,
  createWhatsAppOutboxDrainFromEnv,
} from "../drains/from-env";
import {
  createDeadline,
  DEFAULT_CRON_BUDGET_MS,
  type Deadline,
} from "./deadline";
import { runPaymentJobsDrain } from "./payment-jobs";
import type { CronDrainsResponse, DrainCronEntry } from "./types";

const MAX_DRAIN_BATCH = 50;

function resolveLimit(raw: number | undefined): number {
  return Math.min(
    MAX_DRAIN_BATCH,
    Math.max(1, Math.trunc(raw ?? DEFAULT_DRAIN_BATCH_LIMIT)),
  );
}

function summarizeDrain(result: DrainBatchResult): DrainCronEntry["result"] {
  return {
    claimed: result.claimed,
    delivered: result.delivered,
    retryable: result.retryable,
    deadLetter: result.deadLetter,
    skipped: result.skipped,
    leaseLost: result.leaseLost,
    errors: result.errors,
    durationMs: result.durationMs,
  };
}

async function createActiveDrains(): Promise<OutboxDrain[]> {
  const [whatsapp, email, paymentAudit] = await Promise.all([
    createWhatsAppOutboxDrainFromEnv(),
    createEmailOutboxDrainFromEnv(),
    createPaymentConnectAuditOutboxDrainFromEnv(),
  ]);
  // notification = no-op MVP (inventaire) — appelé pour observabilité
  const notification = createNotificationOutboxDrainFromEnv();
  return [whatsapp, email, paymentAudit, notification];
}

export type RunScheduledDrainsInput = {
  requestId: string;
  limit?: number;
  leaseSeconds?: number;
  budgetMs?: number;
  deadline?: Deadline;
  /** Inclure le drain payment_execution_job (défaut true). */
  includePaymentJobs?: boolean;
};

/**
 * Drains outbox actifs + (optionnel) jobs paiement.
 * Aucun tenant libre depuis le caller.
 */
export async function runScheduledDrains(
  input: RunScheduledDrainsInput,
): Promise<CronDrainsResponse> {
  const started = Date.now();
  const deadline =
    input.deadline ??
    createDeadline(input.budgetMs ?? DEFAULT_CRON_BUDGET_MS, started);
  const limit = resolveLimit(input.limit);
  const leaseSeconds = Math.min(
    600,
    Math.max(30, Math.trunc(input.leaseSeconds ?? DEFAULT_DRAIN_LEASE_SECONDS)),
  );

  logServerEvent("info", "outbox_sent", {
    requestId: input.requestId,
    job: "drains",
    phase: "started",
    limit,
  });

  const drainEntries: DrainCronEntry[] = [];
  let overall: CronDrainsResponse["status"] = "completed";

  try {
    if (deadline.isExpired()) {
      overall = "deadline_reached";
    } else {
      const drains = await createActiveDrains();
      const results = await runAllActiveDrains({
        drains,
        limit,
        leaseSeconds,
        now: () => new Date(),
      });

      for (const result of results) {
        const status: DrainCronEntry["status"] =
          result.errors > 0 ? "partial" : "completed";
        if (status === "partial") {
          overall = "partial";
        }
        drainEntries.push({
          kind: result.kind,
          status,
          result: summarizeDrain(result),
        });
        logServerEvent(
          result.errors > 0 ? "warn" : "info",
          result.errors > 0 ? "outbox_failed" : "outbox_sent",
          {
            requestId: input.requestId,
            kind: result.kind,
            claimed: result.claimed,
            delivered: result.delivered,
            retryable: result.retryable,
            deadLetter: result.deadLetter,
            errors: result.errors,
            durationMs: result.durationMs,
          },
        );
      }
    }
  } catch (error) {
    overall = "failed";
    const reasonCode =
      error instanceof Error ? error.message.slice(0, 80) : "drains_bootstrap_failed";
    logServerEvent("error", "outbox_failed", {
      requestId: input.requestId,
      reasonCode,
    });
    return {
      ok: false,
      job: "drains",
      requestId: input.requestId,
      status: "failed",
      durationMs: Math.max(0, Date.now() - started),
      drains: drainEntries,
      paymentJobs: {
        status: "failed",
        reasonCode: "skipped_after_outbox_failure",
        attempted: 0,
        drained: 0,
        succeededPendingWebhook: 0,
        failedTerminal: 0,
        failedRetryable: 0,
        unknown: 0,
        skipped: 0,
      },
    };
  }

  const includePaymentJobs = input.includePaymentJobs !== false;
  const paymentJobs = includePaymentJobs
    ? await runPaymentJobsDrain({
        requestId: input.requestId,
        limit,
        deadline,
      })
    : {
        status: "not_configured" as const,
        reasonCode: "payment_jobs_skipped",
        attempted: 0,
        drained: 0,
        succeededPendingWebhook: 0,
        failedTerminal: 0,
        failedRetryable: 0,
        unknown: 0,
        skipped: 0,
      };

  if (
    paymentJobs.status === "failed" ||
    paymentJobs.status === "partial" ||
    paymentJobs.status === "deadline_reached"
  ) {
    if (overall === "completed") {
      overall = paymentJobs.status === "failed" ? "partial" : paymentJobs.status;
    }
  }

  const durationMs = Math.max(0, Date.now() - started);
  logServerEvent("info", "outbox_sent", {
    requestId: input.requestId,
    job: "drains",
    phase: "completed",
    status: overall,
    durationMs,
    drainCount: drainEntries.length,
    paymentJobsStatus: paymentJobs.status,
  });

  return {
    ok:
      overall === "completed" ||
      overall === "partial" ||
      overall === "deadline_reached" ||
      overall === "not_configured",
    job: "drains",
    requestId: input.requestId,
    status: overall,
    durationMs,
    drains: drainEntries,
    paymentJobs,
  };
}
