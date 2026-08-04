/**
 * Entrypoints cron runtime P0 — orchestration scanners + drains.
 *
 * Auth : voir `./auth` (Bearer CRON_SECRET).
 * Routes HTTP : `src/app/api/cron/**`.
 */

export { assertCronAuthorized, getCronSecret } from "./auth";
export {
  createDeadline,
  DEFAULT_CRON_BUDGET_MS,
  type Deadline,
} from "./deadline";
export {
  createScannerCandidateSourceFromEnv,
  isScannerCandidateAdminConfigured,
  SCANNER_CANDIDATE_SOURCE_STATUS,
} from "./candidates-from-env";
export { runScheduledScanners } from "./run-scanners";
export { runScheduledDrains } from "./run-drains";
export { runPaymentJobsDrain } from "./payment-jobs";
export type {
  CronDrainsResponse,
  CronJobId,
  CronRunStatus,
  CronScannersResponse,
  DrainCronEntry,
  PaymentJobsDrainSummary,
  ScannerCronEntry,
} from "./types";
