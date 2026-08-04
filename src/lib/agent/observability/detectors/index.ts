/**
 * Détecteurs de sécurité purs G1-I — barrel public.
 * Service : `import { runDetectors } from "./detectors"`
 */

export type {
  DetectorOptions,
  DetectAllOptions,
  ObservabilityEventLike,
  SecuritySignal,
  SecuritySignalType,
  SecuritySignalReasonCode,
  ObservabilityEvent,
  ObservabilitySeverity,
  SecuritySignalSeverity,
  DetectionWindow,
  DetectorThresholds,
  RunDetectorsInput,
} from "./types";

export {
  SECURITY_SIGNAL_TYPES,
  SECURITY_SIGNAL_REASON_CODES,
} from "./types";

export {
  DEFAULT_DETECTOR_THRESHOLDS,
  resolveThreshold,
} from "./thresholds";

export {
  runDetectors,
  detectAllSecuritySignals,
} from "./run-detectors";

export { detectRepeatedPermissionDenials } from "./repeated-permission-denials";
export { detectRepeatedApprovalReplays } from "./repeated-approval-replays";
export { detectIdempotencyConflicts } from "./idempotency-conflicts";
export { detectExecutorFailures } from "./executor-failures";
export { detectAuditPersistenceFailures } from "./audit-persistence-failures";
export { detectApprovalConsumedWithoutExecution } from "./approval-consumed-without-execution";
export { detectIndeterminateExecutionOutcomes } from "./indeterminate-execution-outcomes";
export { detectInvalidArgumentBurst } from "./invalid-argument-burst";
export { detectCrossTenantScopeMismatch } from "./cross-tenant-scope-mismatch";
export { detectNonCallableToolAttempts } from "./non-callable-tool-attempts";
