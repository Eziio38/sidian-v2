/**
 * Types synthétiques des réponses cron — sans secrets, sans PII, sans payloads.
 */

import type { DocumentUploadsPurgeSummary } from "@/lib/documents/cron-purge";

import type { DrainBatchResult } from "../drains/types";
import type { ScannerRunResult } from "../scanners/runner";
import type { WorkflowScannerKind } from "../workflow-policy";

export type CronJobId = "scanners" | "drains";

export type CronRunStatus =
  | "completed"
  | "partial"
  | "not_configured"
  | "deadline_reached"
  | "failed";

export type ScannerCronEntry = {
  scannerKind: WorkflowScannerKind;
  status: CronRunStatus;
  reasonCode?: string;
  result?: Pick<
    ScannerRunResult,
    | "policyVersion"
    | "candidateCount"
    | "claimedCount"
    | "enqueuedCount"
    | "duplicateCount"
    | "failedCount"
  >;
};

export type DrainCronEntry = {
  kind: string;
  status: CronRunStatus;
  reasonCode?: string;
  result?: Pick<
    DrainBatchResult,
    | "claimed"
    | "delivered"
    | "retryable"
    | "deadLetter"
    | "skipped"
    | "leaseLost"
    | "errors"
    | "durationMs"
  >;
};

export type PaymentJobsDrainSummary = {
  status: CronRunStatus;
  reasonCode?: string;
  attempted: number;
  drained: number;
  succeededPendingWebhook: number;
  failedTerminal: number;
  failedRetryable: number;
  unknown: number;
  skipped: number;
};

export type RuntimeJobsDrainSummary = {
  status: CronRunStatus;
  reasonCode?: string;
  claimed: number;
  completed: number;
  retryable: number;
  terminal: number;
  leaseLost: number;
  /**
   * Types de jobs en file sans consommateur — jamais claimés.
   * Rendus visibles pour qu'un câblage manquant ne s'accumule pas en silence.
   */
  unwired: Array<{ jobKind: string; reason: string; pending: number }>;
  durationMs: number;
};

export type CronScannersResponse = {
  ok: boolean;
  job: "scanners";
  requestId: string;
  status: CronRunStatus;
  policyVersion: string;
  durationMs: number;
  scanners: ScannerCronEntry[];
};

export type CronDrainsResponse = {
  ok: boolean;
  job: "drains";
  requestId: string;
  status: CronRunStatus;
  durationMs: number;
  drains: DrainCronEntry[];
  paymentJobs: PaymentJobsDrainSummary;
  runtimeJobs: RuntimeJobsDrainSummary;
  /**
   * Ménage des téléversements jamais confirmés. Optionnel : absent quand le
   * passage n'a pas été atteint (échec amont). Voir
   * `src/lib/documents/cron-purge.ts`.
   */
  documentUploads?: DocumentUploadsPurgeSummary;
};
