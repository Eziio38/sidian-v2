/**
 * Orchestrateur commun : eligibility → ensure leases → claim SKIP LOCKED
 * → enqueue jobs → complete/fail lease. Aucun effet externe.
 */

import type { Clock } from "../clock";
import { RuntimeError } from "../errors";
import type { RuntimeJobRepository } from "../jobs/types";
import {
  SCANNER_TO_JOB_KIND,
  WORKFLOW_POLICY,
  buildJobIdempotencyKey,
  type WorkflowPolicy,
  type WorkflowScannerKind,
  utcCalendarDate,
} from "../workflow-policy";
import type { EligibleOccurrence } from "./eligibility";
import type { ScanLeaseRepository } from "./lease-types";

export type ScannerRunResult = {
  scannerKind: WorkflowScannerKind;
  policyVersion: string;
  scannedAt: string;
  today: string;
  candidateCount: number;
  claimedCount: number;
  enqueuedCount: number;
  duplicateCount: number;
  failedCount: number;
  jobIds: string[];
};

export type ScannerRunDeps = {
  clock: Clock;
  leases: ScanLeaseRepository;
  jobs: RuntimeJobRepository;
  policy?: WorkflowPolicy;
  batchSize?: number;
  leaseSeconds?: number;
};

function resolveBatchSize(
  requested: number | undefined,
  policy: WorkflowPolicy,
): number {
  const raw = requested ?? policy.scanner.defaultBatchSize;
  return Math.min(
    policy.scanner.maxBatchSize,
    Math.max(1, Math.trunc(raw)),
  );
}

function resolveLeaseSeconds(
  requested: number | undefined,
  policy: WorkflowPolicy,
): number {
  const raw = requested ?? policy.scanner.defaultLeaseSeconds;
  return Math.min(
    policy.scanner.maxLeaseSeconds,
    Math.max(policy.scanner.minLeaseSeconds, Math.trunc(raw)),
  );
}

export async function runScannerBatch(input: {
  scannerKind: WorkflowScannerKind;
  eligible: EligibleOccurrence[];
  deps: ScannerRunDeps;
}): Promise<ScannerRunResult> {
  const policy = input.deps.policy ?? WORKFLOW_POLICY;
  const nowDate = input.deps.clock.now();
  if (Number.isNaN(nowDate.getTime())) {
    throw new RuntimeError("runtime_clock_invalid");
  }
  const now = nowDate.toISOString();
  const today = utcCalendarDate(nowDate);
  const batchSize = resolveBatchSize(input.deps.batchSize, policy);
  const leaseSeconds = resolveLeaseSeconds(input.deps.leaseSeconds, policy);
  const jobKind = SCANNER_TO_JOB_KIND[input.scannerKind];

  const result: ScannerRunResult = {
    scannerKind: input.scannerKind,
    policyVersion: policy.version,
    scannedAt: now,
    today,
    candidateCount: input.eligible.length,
    claimedCount: 0,
    enqueuedCount: 0,
    duplicateCount: 0,
    failedCount: 0,
    jobIds: [],
  };

  if (input.eligible.length === 0) {
    return result;
  }

  const items = input.eligible.map((e) => ({
    creanceId: e.creanceId,
    occurrenceKey: e.occurrenceKey,
  }));

  await input.deps.leases.ensure({
    scannerKind: input.scannerKind,
    items,
    policyVersion: policy.version,
  });

  const claimed = await input.deps.leases.claim({
    scannerKind: input.scannerKind,
    items,
    now,
    leaseSeconds,
    batchSize,
  });
  result.claimedCount = claimed.length;

  const byKey = new Map(
    input.eligible.map((e) => [`${e.creanceId}::${e.occurrenceKey}`, e]),
  );

  for (const claim of claimed) {
    const eligible = byKey.get(
      `${claim.creanceId}::${claim.occurrenceKey}`,
    );
    if (!eligible) {
      await input.deps.leases.fail({
        scannerKind: input.scannerKind,
        creanceId: claim.creanceId,
        occurrenceKey: claim.occurrenceKey,
        leaseToken: claim.leaseToken,
        now,
        errorCode: "candidate_missing",
      });
      result.failedCount += 1;
      continue;
    }

    try {
      const idempotencyKey = buildJobIdempotencyKey({
        jobKind,
        creanceId: eligible.creanceId,
        occurrenceKey: eligible.occurrenceKey,
      });
      const enqueued = await input.deps.jobs.enqueue({
        prestataireId: eligible.prestataireId,
        creanceId: eligible.creanceId,
        dossierSuiviId: eligible.dossierSuiviId,
        scannerKind: input.scannerKind,
        jobKind,
        policyVersion: policy.version,
        idempotencyKey,
        payload: {
          ...eligible.payload,
          scanner_kind: input.scannerKind,
          policy_version: policy.version,
          scanned_at: now,
        },
        availableAt: now,
        now,
      });

      result.jobIds.push(enqueued.jobId);
      if (enqueued.enqueued) {
        result.enqueuedCount += 1;
      } else {
        result.duplicateCount += 1;
      }

      const completed = await input.deps.leases.complete({
        scannerKind: input.scannerKind,
        creanceId: claim.creanceId,
        occurrenceKey: claim.occurrenceKey,
        leaseToken: claim.leaseToken,
        now,
      });
      if (!completed) {
        // Lease perdu (crash concurrent) — job déjà idempotent.
        result.failedCount += 1;
      }
    } catch {
      await input.deps.leases.fail({
        scannerKind: input.scannerKind,
        creanceId: claim.creanceId,
        occurrenceKey: claim.occurrenceKey,
        leaseToken: claim.leaseToken,
        now,
        errorCode: "enqueue_failed",
      });
      result.failedCount += 1;
    }
  }

  return result;
}
