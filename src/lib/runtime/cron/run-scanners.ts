/**
 * Orchestration scanners planifiés — enqueue jobs uniquement (pas d’effets externes).
 */

import "server-only";

import { logServerEvent } from "@/lib/observability/server-logger";
import { createAdminClient } from "@/lib/supabase/admin";

import { createSystemClock } from "../clock";
import { RuntimeError } from "../errors";
import { createSupabaseRuntimeJobRepository } from "../jobs/supabase-repository";
import {
  runAutoPayScanner,
  runClosureScanner,
  runDueScanner,
  runPreventionScanner,
  runRetriesScanner,
  runSilenceScanner,
  type ScannerRunDeps,
  type ScannerRunResult,
} from "../scanners";
import { createSupabaseScanLeaseRepository } from "../scanners/supabase-lease-repository";
import {
  WORKFLOW_POLICY,
  type WorkflowScannerKind,
} from "../workflow-policy";
import { createScannerCandidateSourceFromEnv } from "./candidates-from-env";
import {
  createDeadline,
  DEFAULT_CRON_BUDGET_MS,
  type Deadline,
} from "./deadline";
import type { CronScannersResponse, ScannerCronEntry } from "./types";

const SCANNER_ORDER: readonly WorkflowScannerKind[] = [
  "prevention",
  "due",
  "silence",
  "closure",
  "auto_pay",
  "retries",
] as const;

function resolveBatchSize(raw: number | undefined): number {
  const value = raw ?? WORKFLOW_POLICY.scanner.defaultBatchSize;
  return Math.min(
    WORKFLOW_POLICY.scanner.maxBatchSize,
    Math.max(1, Math.trunc(value)),
  );
}

function isNotConfigured(error: unknown): boolean {
  return (
    error instanceof RuntimeError && error.code === "not_configured"
  );
}

function summarizeResult(result: ScannerRunResult): ScannerCronEntry["result"] {
  return {
    policyVersion: result.policyVersion,
    candidateCount: result.candidateCount,
    claimedCount: result.claimedCount,
    enqueuedCount: result.enqueuedCount,
    duplicateCount: result.duplicateCount,
    failedCount: result.failedCount,
  };
}

async function runOneScanner(params: {
  kind: WorkflowScannerKind;
  deps: ScannerRunDeps;
  source: Awaited<ReturnType<typeof createScannerCandidateSourceFromEnv>>;
}): Promise<ScannerRunResult> {
  switch (params.kind) {
    case "prevention":
      return runPreventionScanner(params.source, params.deps);
    case "due":
      return runDueScanner(params.source, params.deps);
    case "silence":
      return runSilenceScanner(params.source, params.deps);
    case "closure":
      return runClosureScanner(params.source, params.deps);
    case "auto_pay":
      return runAutoPayScanner(params.source, params.deps);
    case "retries":
      return runRetriesScanner(params.source, params.deps);
    default: {
      const _exhaustive: never = params.kind;
      throw new RuntimeError(
        "unknown_scanner",
        `unknown_scanner:${String(_exhaustive)}`,
      );
    }
  }
}

export type RunScheduledScannersInput = {
  requestId: string;
  batchSize?: number;
  leaseSeconds?: number;
  budgetMs?: number;
  deadline?: Deadline;
};

/**
 * Exécute tous les scanners V2 dans un ordre stable, batches bornés,
 * soft-deadline. Aucun tenant fourni par le caller.
 */
export async function runScheduledScanners(
  input: RunScheduledScannersInput,
): Promise<CronScannersResponse> {
  const started = Date.now();
  const deadline =
    input.deadline ??
    createDeadline(input.budgetMs ?? DEFAULT_CRON_BUDGET_MS, started);

  logServerEvent("info", "scanner_started", {
    requestId: input.requestId,
    job: "scanners",
    policyVersion: WORKFLOW_POLICY.version,
  });

  const entries: ScannerCronEntry[] = [];
  let overall: CronScannersResponse["status"] = "completed";

  try {
    // Credentials d’abord → not_configured explicite (pas de stub métier).
    const source = await createScannerCandidateSourceFromEnv();
    const admin = await createAdminClient();
    const deps: ScannerRunDeps = {
      clock: createSystemClock(),
      leases: createSupabaseScanLeaseRepository(admin),
      jobs: createSupabaseRuntimeJobRepository(admin),
      policy: WORKFLOW_POLICY,
      batchSize: resolveBatchSize(input.batchSize),
      leaseSeconds: input.leaseSeconds,
    };

    for (const kind of SCANNER_ORDER) {
      if (deadline.isExpired()) {
        overall = "deadline_reached";
        entries.push({
          scannerKind: kind,
          status: "deadline_reached",
          reasonCode: "cron_soft_deadline",
        });
        continue;
      }

      try {
        const result = await runOneScanner({ kind, deps, source });
        entries.push({
          scannerKind: kind,
          status: "completed",
          result: summarizeResult(result),
        });
        logServerEvent("info", "scanner_completed", {
          requestId: input.requestId,
          scannerKind: kind,
          claimedCount: result.claimedCount,
          enqueuedCount: result.enqueuedCount,
          duplicateCount: result.duplicateCount,
          failedCount: result.failedCount,
        });
      } catch (error) {
        if (isNotConfigured(error)) {
          overall = overall === "completed" ? "not_configured" : overall;
          entries.push({
            scannerKind: kind,
            status: "not_configured",
            reasonCode: "scanner_candidate_source_not_configured",
          });
          logServerEvent("warn", "scanner_completed", {
            requestId: input.requestId,
            scannerKind: kind,
            status: "not_configured",
            reasonCode: "scanner_candidate_source_not_configured",
          });
          continue;
        }

        overall = "partial";
        const reasonCode =
          error instanceof RuntimeError
            ? error.code
            : error instanceof Error
              ? error.message.slice(0, 80)
              : "scanner_failed";
        entries.push({
          scannerKind: kind,
          status: "failed",
          reasonCode,
        });
        logServerEvent("error", "scanner_completed", {
          requestId: input.requestId,
          scannerKind: kind,
          status: "failed",
          reasonCode,
        });
      }
    }
  } catch (error) {
    if (isNotConfigured(error)) {
      const reasonCode = "scanner_candidate_source_not_configured";
      logServerEvent("warn", "scanner_completed", {
        requestId: input.requestId,
        status: "not_configured",
        reasonCode,
      });
      return {
        ok: true,
        job: "scanners",
        requestId: input.requestId,
        status: "not_configured",
        policyVersion: WORKFLOW_POLICY.version,
        durationMs: Math.max(0, Date.now() - started),
        scanners: SCANNER_ORDER.map((scannerKind) => ({
          scannerKind,
          status: "not_configured" as const,
          reasonCode,
        })),
      };
    }

    overall = "failed";
    const reasonCode =
      error instanceof Error ? error.message.slice(0, 80) : "scanners_bootstrap_failed";
    logServerEvent("error", "scanner_completed", {
      requestId: input.requestId,
      status: "failed",
      reasonCode,
    });
    return {
      ok: false,
      job: "scanners",
      requestId: input.requestId,
      status: "failed",
      policyVersion: WORKFLOW_POLICY.version,
      durationMs: Math.max(0, Date.now() - started),
      scanners: entries,
    };
  }

  if (
    overall === "completed" &&
    entries.some((e) => e.status === "failed" || e.status === "not_configured")
  ) {
    overall = entries.every((e) => e.status === "not_configured")
      ? "not_configured"
      : "partial";
  }

  const durationMs = Math.max(0, Date.now() - started);
  logServerEvent("info", "scanner_completed", {
    requestId: input.requestId,
    job: "scanners",
    status: overall,
    durationMs,
    scannerCount: entries.length,
  });

  return {
    ok: overall === "completed" || overall === "not_configured" || overall === "partial" || overall === "deadline_reached",
    job: "scanners",
    requestId: input.requestId,
    status: overall,
    policyVersion: WORKFLOW_POLICY.version,
    durationMs,
    scanners: entries,
  };
}
