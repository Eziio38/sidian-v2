/**
 * Runtime P0 — scanners planifiés + politique de calendrier V2.
 *
 * Les scanners enqueue des `runtime_job` (outbox). Ils n’appellent jamais
 * Stripe, WhatsApp, Email ou LLM.
 */

export {
  createFixedClock,
  createSystemClock,
  type Clock,
} from "./clock";
export { RuntimeError } from "./errors";
export {
  createMemoryRuntimeJobRepository,
  createSupabaseRuntimeJobRepository,
  type EnqueueRuntimeJobInput,
  type EnqueueRuntimeJobResult,
  type MemoryRuntimeJobRepository,
  type RuntimeJobRecord,
  type RuntimeJobRepository,
  type RuntimeJobRpcClient,
  type RuntimeJobStatus,
} from "./jobs";
export {
  createMemoryScanLeaseRepository,
  createSupabaseScanLeaseRepository,
  createSupabaseScannerCandidateSource,
  runAutoPayScanner,
  runClosureScanner,
  runDueScanner,
  runPreventionScanner,
  runRetriesScanner,
  runScannerBatch,
  runSilenceScanner,
  selectAutoPayEligible,
  selectClosureEligible,
  selectDueEligible,
  selectPreventionEligible,
  selectRetriesEligible,
  selectSilenceEligible,
  type EligibleOccurrence,
  type FailedTentativeSnapshot,
  type MemoryScanLeaseRepository,
  type OpenCreanceSnapshot,
  type RuntimeLeaseRpcClient,
  type ScannerCandidateQueryClient,
  type ScannerCandidateSource,
  type ScannerRunDeps,
  type ScannerRunResult,
  type ScanLeaseRepository,
  type TerminalCreanceSnapshot,
} from "./scanners";
export {
  REJECTED_LEGACY_ENROLLMENT_OFFSETS_DAYS,
  SCANNER_TO_JOB_KIND,
  WORKFLOW_POLICY,
  WORKFLOW_POLICY_VERSION,
  addUtcDays,
  buildJobIdempotencyKey,
  clampSilenceGraceDays,
  isDueReached,
  isInPreventionWindow,
  isSilenceWindowReached,
  resolveSilenceGraceDays,
  utcCalendarDate,
  type RetryPolicyKind,
  type WorkflowJobKind,
  type WorkflowPolicy,
  type WorkflowScannerKind,
} from "./workflow-policy";
