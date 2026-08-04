/**
 * Fixtures d’entrée ObservabilityRecordInput (mémoire, zéro I/O).
 */

import type { ObservabilityRecordInput } from "@/lib/agent/observability";

import {
  CORRELATION_ID,
  FIXED_NOW,
  TENANT_A,
  TOOL_ID,
  TOOL_VERSION,
  WINDOW_END,
  WINDOW_START,
} from "./constants";

/** Entrée nominale — succès router. */
export function baseRecordInput(
  overrides: Partial<ObservabilityRecordInput> = {},
): ObservabilityRecordInput {
  return {
    now: FIXED_NOW,
    correlation_id: CORRELATION_ID,
    tenant_id: TENANT_A,
    component: "tool_router",
    operation: "route",
    outcome: "success",
    severity: "info",
    duration_ms: 12,
    tool_id: TOOL_ID,
    tool_version: TOOL_VERSION,
    mode: "agir",
    autonomy_level: 1,
    resource_kind: "invoice",
    reason_code: "SUCCESS",
    ...overrides,
  };
}

export function successRecordInput(
  overrides: Partial<ObservabilityRecordInput> = {},
): ObservabilityRecordInput {
  return baseRecordInput({
    outcome: "success",
    severity: "info",
    reason_code: "SUCCESS",
    ...overrides,
  });
}

export function blockedPermissionDeniedInput(
  overrides: Partial<ObservabilityRecordInput> = {},
): ObservabilityRecordInput {
  return baseRecordInput({
    outcome: "blocked",
    severity: "warning",
    reason_code: "PERMISSION_DENIED",
    error_code: "PERMISSION_DENIED",
    duration_ms: 3,
    ...overrides,
  });
}

export function approvalRequiredInput(
  overrides: Partial<ObservabilityRecordInput> = {},
): ObservabilityRecordInput {
  return baseRecordInput({
    outcome: "blocked",
    severity: "warning",
    reason_code: "VALIDATION_REQUIRED",
    approval_status: "pending",
    ...overrides,
  });
}

export function approvalReplayInput(
  overrides: Partial<ObservabilityRecordInput> = {},
): ObservabilityRecordInput {
  return baseRecordInput({
    outcome: "replayed",
    severity: "warning",
    reason_code: "APPROVAL_ALREADY_CONSUMED",
    approval_status: "already_consumed",
    replayed: true,
    ...overrides,
  });
}

export function idempotencyConflictInput(
  overrides: Partial<ObservabilityRecordInput> = {},
): ObservabilityRecordInput {
  return baseRecordInput({
    outcome: "blocked",
    severity: "error",
    reason_code: "IDEMPOTENCY_KEY_CONFLICT",
    idempotency_status: "conflict",
    ...overrides,
  });
}

export function executorErrorInput(
  overrides: Partial<ObservabilityRecordInput> = {},
): ObservabilityRecordInput {
  return baseRecordInput({
    component: "executor",
    operation: "execute",
    outcome: "error",
    severity: "error",
    reason_code: "EXECUTOR_TECHNICAL_ERROR",
    error_code: "EXECUTOR_TECHNICAL_ERROR",
    ...overrides,
  });
}

export function auditPersistenceFailureInput(
  overrides: Partial<ObservabilityRecordInput> = {},
): ObservabilityRecordInput {
  return baseRecordInput({
    component: "audit",
    operation: "append",
    outcome: "error",
    severity: "error",
    reason_code: "AUDIT_PERSISTENCE_FAILED",
    error_code: "AUDIT_PERSISTENCE_FAILED",
    ...overrides,
  });
}

export function indeterminateInput(
  overrides: Partial<ObservabilityRecordInput> = {},
): ObservabilityRecordInput {
  return baseRecordInput({
    outcome: "degraded",
    severity: "error",
    reason_code: "IDEMPOTENCY_COMPLETION_FAILED",
    execution_outcome: "indeterminate",
    idempotency_status: "completion_failed",
    ...overrides,
  });
}

export function invalidArgumentInput(
  overrides: Partial<ObservabilityRecordInput> = {},
): ObservabilityRecordInput {
  return baseRecordInput({
    outcome: "blocked",
    severity: "warning",
    reason_code: "INVALID_ARGUMENT",
    error_code: "INVALID_ARGUMENT",
    ...overrides,
  });
}

export function crossTenantMismatchInput(
  overrides: Partial<ObservabilityRecordInput> = {},
): ObservabilityRecordInput {
  return baseRecordInput({
    outcome: "blocked",
    severity: "critical",
    reason_code: "TENANT_SCOPE_MISMATCH",
    error_code: "TENANT_SCOPE_MISMATCH",
    ...overrides,
  });
}

export function nonCallableToolInput(
  overrides: Partial<ObservabilityRecordInput> = {},
): ObservabilityRecordInput {
  return baseRecordInput({
    outcome: "blocked",
    severity: "warning",
    reason_code: "TOOL_NOT_CALLABLE",
    error_code: "TOOL_NOT_CALLABLE",
    ...overrides,
  });
}

export function detectionWindow() {
  return { start: WINDOW_START, end: WINDOW_END };
}
