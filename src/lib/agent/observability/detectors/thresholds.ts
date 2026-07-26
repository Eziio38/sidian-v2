/**
 * Seuils par défaut des détecteurs G1-I.
 * Déclenchement inclusif : count >= threshold.
 */

import type { DetectorThresholds, SecuritySignalType } from "../types";

export const DEFAULT_DETECTOR_THRESHOLDS: Readonly<DetectorThresholds> = {
  repeated_permission_denials: 5,
  repeated_approval_replays: 3,
  idempotency_conflicts: 3,
  executor_failures: 5,
  audit_persistence_failures: 1,
  approval_consumed_without_execution: 1,
  indeterminate_execution_outcomes: 1,
  invalid_argument_burst: 5,
  cross_tenant_scope_mismatch: 1,
  non_callable_tool_attempts: 3,
};

export function resolveThreshold(
  key: SecuritySignalType,
  override?: number,
): number {
  if (override !== undefined) {
    if (!Number.isFinite(override) || override < 1) {
      return DEFAULT_DETECTOR_THRESHOLDS[key];
    }
    return Math.floor(override);
  }
  return DEFAULT_DETECTOR_THRESHOLDS[key];
}
