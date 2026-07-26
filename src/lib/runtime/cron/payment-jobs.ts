/**
 * Drain borné des payment_execution_job — uniquement via cron authentifié.
 * Jamais depuis un webhook entrant.
 */

import "server-only";

import { isStripePaymentsEnabled } from "@/config/env-server";
import { logServerEvent } from "@/lib/observability/server-logger";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  createPaymentRuntimeService,
  createSupabasePaymentAttemptRepository,
  createSupabasePaymentJobRepository,
  PAYMENT_JOB_LEASE_SECONDS,
  type DrainJobResult,
} from "../payments";
import type { Deadline } from "./deadline";
import type { PaymentJobsDrainSummary } from "./types";

const DEFAULT_PAYMENT_JOB_BATCH = 10;
const MAX_PAYMENT_JOB_BATCH = 25;

function emptySummary(
  status: PaymentJobsDrainSummary["status"],
  reasonCode?: string,
): PaymentJobsDrainSummary {
  return {
    status,
    reasonCode,
    attempted: 0,
    drained: 0,
    succeededPendingWebhook: 0,
    failedTerminal: 0,
    failedRetryable: 0,
    unknown: 0,
    skipped: 0,
  };
}

function classify(result: DrainJobResult, summary: PaymentJobsDrainSummary): void {
  summary.drained += 1;
  if (result.status === "pending") {
    summary.succeededPendingWebhook += 1;
    return;
  }
  if (result.status === "unknown") {
    summary.unknown += 1;
    return;
  }
  if (result.status === "failure") {
    if (result.code === "PROVIDER_TEMPORARY_FAILURE") {
      summary.failedRetryable += 1;
    } else {
      summary.failedTerminal += 1;
    }
    return;
  }
  if (result.status === "skipped_in_progress") {
    summary.skipped += 1;
    logServerEvent("info", "payment_execution_skipped", {
      reasonCode: "skipped_in_progress",
    });
    return;
  }
  summary.skipped += 1;
}

/**
 * Claim + exécute jusqu’à `limit` jobs paiement, soft-deadline aware.
 * Tenant jamais fourni par le caller — le claim SQL global service_role
 * sélectionne le prochain job éligible.
 */
export async function runPaymentJobsDrain(input: {
  requestId: string;
  limit?: number;
  deadline?: Deadline;
}): Promise<PaymentJobsDrainSummary> {
  if (!isStripePaymentsEnabled()) {
    return emptySummary("not_configured", "payments_disabled");
  }

  const limit = Math.min(
    MAX_PAYMENT_JOB_BATCH,
    Math.max(1, Math.trunc(input.limit ?? DEFAULT_PAYMENT_JOB_BATCH)),
  );

  logServerEvent("info", "payment_execution_started", {
    requestId: input.requestId,
    limit,
  });

  try {
    const admin = await createAdminClient();
    const runtime = createPaymentRuntimeService({
      jobs: createSupabasePaymentJobRepository(admin),
      attempts: createSupabasePaymentAttemptRepository(admin),
      paymentsEnabled: true,
      leaseSeconds: PAYMENT_JOB_LEASE_SECONDS,
    });

    runtime.assertNotInboundWebhook({ caller: "cron_payment_jobs_drain" });

    const summary = emptySummary("completed");

    for (let i = 0; i < limit; i += 1) {
      if (input.deadline?.isExpired()) {
        summary.status = "deadline_reached";
        summary.reasonCode = "cron_soft_deadline";
        break;
      }

      summary.attempted += 1;
      const result = await runtime.drain();
      if (!result) {
        break;
      }
      classify(result, summary);

      if (result.status === "pending") {
        logServerEvent("info", "payment_execution_started", {
          requestId: input.requestId,
          outcome: "pending_webhook",
        });
      } else if (result.status === "failure") {
        logServerEvent("warn", "payment_execution_failed", {
          requestId: input.requestId,
          code: result.code,
        });
      } else if (result.status === "unknown") {
        logServerEvent("warn", "payment_execution_failed", {
          requestId: input.requestId,
          code: "UNKNOWN_PROVIDER_RESULT",
        });
      }
    }

    return summary;
  } catch (error) {
    const reasonCode =
      error instanceof Error ? error.message.slice(0, 80) : "payment_drain_failed";
    logServerEvent("error", "payment_execution_failed", {
      requestId: input.requestId,
      reasonCode,
    });
    return emptySummary("failed", reasonCode);
  }
}
