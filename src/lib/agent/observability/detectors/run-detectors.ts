/**
 * Orchestrateur pur — contrats :
 * - `runDetectors(input)` (service)
 * - `detectAllSecuritySignals(events, window, options?)` (API directe)
 */

import { detectApprovalConsumedWithoutExecution } from "./approval-consumed-without-execution";
import { detectAuditPersistenceFailures } from "./audit-persistence-failures";
import { detectCrossTenantScopeMismatch } from "./cross-tenant-scope-mismatch";
import { detectExecutorFailures } from "./executor-failures";
import { detectIdempotencyConflicts } from "./idempotency-conflicts";
import { detectIndeterminateExecutionOutcomes } from "./indeterminate-execution-outcomes";
import { detectInvalidArgumentBurst } from "./invalid-argument-burst";
import { detectNonCallableToolAttempts } from "./non-callable-tool-attempts";
import { detectRepeatedApprovalReplays } from "./repeated-approval-replays";
import { detectRepeatedPermissionDenials } from "./repeated-permission-denials";
import { resolveThreshold } from "./thresholds";
import type {
  DetectAllOptions,
  DetectionWindow,
  DetectorThresholds,
  ObservabilityEventLike,
  RunDetectorsInput,
  SecuritySignal,
  SecuritySignalType,
} from "./types";

function thresholdFor(
  key: SecuritySignalType,
  overrides?: Partial<DetectorThresholds>,
): number {
  return resolveThreshold(key, overrides?.[key]);
}

/**
 * Exécute les dix détecteurs G1-I.
 * Ne mute pas `events`. Pas de Date.now(). Ordre de sortie stable.
 */
export function detectAllSecuritySignals(
  events: readonly ObservabilityEventLike[],
  window: DetectionWindow,
  options?: DetectAllOptions,
): SecuritySignal[] {
  const t = options?.thresholds;
  const detectedAt = options?.now ?? window.end;

  const signals: SecuritySignal[] = [
    ...detectRepeatedPermissionDenials(events, window, {
      threshold: thresholdFor("repeated_permission_denials", t),
      now: detectedAt,
    }),
    ...detectRepeatedApprovalReplays(events, window, {
      threshold: thresholdFor("repeated_approval_replays", t),
      now: detectedAt,
    }),
    ...detectIdempotencyConflicts(events, window, {
      threshold: thresholdFor("idempotency_conflicts", t),
      now: detectedAt,
    }),
    ...detectExecutorFailures(events, window, {
      threshold: thresholdFor("executor_failures", t),
      now: detectedAt,
    }),
    ...detectAuditPersistenceFailures(events, window, {
      threshold: thresholdFor("audit_persistence_failures", t),
      now: detectedAt,
    }),
    ...detectApprovalConsumedWithoutExecution(events, window, {
      threshold: thresholdFor("approval_consumed_without_execution", t),
      now: detectedAt,
    }),
    ...detectIndeterminateExecutionOutcomes(events, window, {
      threshold: thresholdFor("indeterminate_execution_outcomes", t),
      now: detectedAt,
    }),
    ...detectInvalidArgumentBurst(events, window, {
      threshold: thresholdFor("invalid_argument_burst", t),
      now: detectedAt,
    }),
    ...detectCrossTenantScopeMismatch(events, window, {
      threshold: thresholdFor("cross_tenant_scope_mismatch", t),
      now: detectedAt,
    }),
    ...detectNonCallableToolAttempts(events, window, {
      threshold: thresholdFor("non_callable_tool_attempts", t),
      now: detectedAt,
    }),
  ];

  return signals.sort((a, b) => {
    if (a.signal_type !== b.signal_type) {
      return a.signal_type < b.signal_type ? -1 : 1;
    }
    if (a.tenant_id !== b.tenant_id) {
      return a.tenant_id < b.tenant_id ? -1 : 1;
    }
    return a.signal_id < b.signal_id ? -1 : a.signal_id > b.signal_id ? 1 : 0;
  });
}

/** Contrat service : `RunDetectorsFn`. */
export function runDetectors(input: RunDetectorsInput): SecuritySignal[] {
  return detectAllSecuritySignals(input.events, input.window, {
    thresholds: input.thresholds,
    now: input.now,
  });
}
