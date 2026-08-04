/**
 * Événements ObservabilityEvent pour métriques / détecteurs (zéro builder).
 */

import type { ObservabilityEvent } from "@/lib/agent/observability";

import {
  CORRELATION_ID,
  FIXED_NOW,
  TENANT_A,
  TENANT_B,
  TOOL_ID,
  TOOL_VERSION,
  WINDOW_END,
  WINDOW_START,
} from "./constants";

let seq = 0;

function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}_${String(seq).padStart(3, "0")}`;
}

/** Remet le compteur d’ids (appelable en beforeEach si besoin). */
export function resetEventIdSeq(): void {
  seq = 0;
}

export function makeEvent(
  overrides: Partial<ObservabilityEvent> = {},
): ObservabilityEvent {
  return {
    event_id: overrides.event_id ?? nextId("evt"),
    occurred_at: overrides.occurred_at ?? FIXED_NOW,
    correlation_id: overrides.correlation_id ?? CORRELATION_ID,
    tenant_id: overrides.tenant_id ?? TENANT_A,
    component: overrides.component ?? "tool_router",
    operation: overrides.operation ?? "route",
    outcome: overrides.outcome ?? "success",
    severity: overrides.severity ?? "info",
    duration_ms: overrides.duration_ms ?? 10,
    tool_id: overrides.tool_id ?? TOOL_ID,
    tool_version: overrides.tool_version ?? TOOL_VERSION,
    reason_code: overrides.reason_code ?? "SUCCESS",
    ...overrides,
    schema_version: "1",
  };
}

export function permissionDeniedEvent(
  overrides: Partial<ObservabilityEvent> = {},
): ObservabilityEvent {
  return makeEvent({
    outcome: "blocked",
    severity: "warning",
    reason_code: "PERMISSION_DENIED",
    error_code: "PERMISSION_DENIED",
    ...overrides,
  });
}

export function approvalReplayEvent(
  overrides: Partial<ObservabilityEvent> = {},
): ObservabilityEvent {
  return makeEvent({
    outcome: "replayed",
    severity: "warning",
    reason_code: "APPROVAL_ALREADY_CONSUMED",
    approval_status: "already_consumed",
    replayed: true,
    ...overrides,
  });
}

export function idempotencyConflictEvent(
  overrides: Partial<ObservabilityEvent> = {},
): ObservabilityEvent {
  return makeEvent({
    outcome: "blocked",
    severity: "error",
    reason_code: "IDEMPOTENCY_KEY_CONFLICT",
    idempotency_status: "conflict",
    ...overrides,
  });
}

export function executorFailureEvent(
  overrides: Partial<ObservabilityEvent> = {},
): ObservabilityEvent {
  return makeEvent({
    component: "tool_router",
    outcome: "error",
    severity: "error",
    reason_code: "EXECUTOR_TECHNICAL_ERROR",
    error_code: "EXECUTOR_TECHNICAL_ERROR",
    ...overrides,
  });
}

export function auditFailureEvent(
  overrides: Partial<ObservabilityEvent> = {},
): ObservabilityEvent {
  return makeEvent({
    component: "audit",
    operation: "append",
    outcome: "error",
    severity: "error",
    reason_code: "AUDIT_PERSISTENCE_FAILED",
    error_code: "AUDIT_PERSISTENCE_FAILED",
    ...overrides,
  });
}

export function approvalConsumedWithoutExecutionEvent(
  overrides: Partial<ObservabilityEvent> = {},
): ObservabilityEvent {
  return makeEvent({
    reason_code: "APPROVAL_CONSUMED_EXECUTION_NOT_STARTED",
    approval_consumed: true,
    execution_outcome: "not_started",
    outcome: "degraded",
    severity: "error",
    ...overrides,
  });
}

export function indeterminateEvent(
  overrides: Partial<ObservabilityEvent> = {},
): ObservabilityEvent {
  return makeEvent({
    outcome: "degraded",
    severity: "error",
    reason_code: "IDEMPOTENCY_COMPLETION_FAILED",
    execution_outcome: "indeterminate",
    idempotency_status: "completion_failed",
    ...overrides,
  });
}

export function invalidArgumentEvent(
  overrides: Partial<ObservabilityEvent> = {},
): ObservabilityEvent {
  return makeEvent({
    outcome: "blocked",
    severity: "warning",
    reason_code: "INVALID_ARGUMENT",
    error_code: "INVALID_ARGUMENT",
    ...overrides,
  });
}

export function crossTenantEvent(
  overrides: Partial<ObservabilityEvent> = {},
): ObservabilityEvent {
  return makeEvent({
    outcome: "blocked",
    reason_code: "TENANT_SCOPE_MISMATCH",
    error_code: "TENANT_SCOPE_MISMATCH",
    severity: "critical",
    ...overrides,
  });
}

export function nonCallableEvent(
  overrides: Partial<ObservabilityEvent> = {},
): ObservabilityEvent {
  return makeEvent({
    outcome: "blocked",
    severity: "warning",
    reason_code: "TOOL_NOT_CALLABLE",
    error_code: "TOOL_NOT_CALLABLE",
    ...overrides,
  });
}

export function neighborTenantDeniedEvent(
  overrides: Partial<ObservabilityEvent> = {},
): ObservabilityEvent {
  return permissionDeniedEvent({
    tenant_id: TENANT_B,
    ...overrides,
  });
}

export function defaultWindow() {
  return { start: WINDOW_START, end: WINDOW_END };
}

/** N événements permission denied espacés dans la fenêtre. */
export function burstPermissionDenials(
  count: number,
  tenantId = TENANT_A,
): ObservabilityEvent[] {
  return Array.from({ length: count }, (_, i) =>
    permissionDeniedEvent({
      event_id: `deny_${tenantId}_${i}`,
      tenant_id: tenantId,
      occurred_at: WINDOW_START,
    }),
  );
}
