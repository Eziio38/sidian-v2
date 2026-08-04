/**
 * Pont Router → Observability Service (G1-I).
 * Émis **après** audit.build (+ append si sink) — au plus un événement par route().
 * Best-effort : un échec obs ne transforme jamais un succès métier en échec
 * (contrairement à l’audit G1-F fail-closed).
 * Aucun réseau, aucune console, aucun secret/stack/args/output.
 */

import type {
  ObservabilityEvent,
  ObservabilityOutcome,
  ObservabilityRecordInput,
  ObservabilityService,
  ObservabilitySeverity,
} from "@/lib/agent/observability";

import type {
  ToolRouteBlocked,
  ToolRouteResult,
  ToolRouteSuccess,
} from "./types";

function attachObservability(
  result: ToolRouteResult,
  event: ObservabilityEvent,
): ToolRouteResult {
  if (result.status === "success") {
    const next: ToolRouteSuccess = { ...result, observability: event };
    return next;
  }
  const next: ToolRouteBlocked = { ...result, observability: event };
  return next;
}

function attachObservabilityDegraded(result: ToolRouteResult): ToolRouteResult {
  if (result.status === "success") {
    const next: ToolRouteSuccess = {
      ...result,
      observability_degraded: true,
    };
    return next;
  }
  const next: ToolRouteBlocked = {
    ...result,
    observability_degraded: true,
  };
  return next;
}

function mapSeverity(outcome: ObservabilityOutcome): ObservabilitySeverity {
  switch (outcome) {
    case "success":
    case "replayed":
      return "info";
    case "denied":
    case "approval_required":
    case "validation_error":
    case "degraded":
      return "warning";
    case "blocked":
    case "error":
      return "error";
    default:
      return "error";
  }
}

function mapOutcomeFromResult(result: ToolRouteResult): {
  outcome: ObservabilityOutcome;
  reason_code?: string;
  error_code?: string;
} {
  if (result.status === "success") {
    if (result.audit?.replayed === true) {
      return {
        outcome: "replayed",
        reason_code: result.audit.reason_code,
      };
    }
    return {
      outcome: "success",
      reason_code: result.audit?.reason_code ?? "SUCCESS",
    };
  }

  const code = result.error.code;
  const auditReason = result.audit?.reason_code;

  if (code === "PERMISSION_DENIED") {
    return {
      outcome: "denied",
      reason_code: auditReason ?? code,
      error_code: code,
    };
  }
  if (code === "APPROVAL_REQUIRED") {
    return {
      outcome: "approval_required",
      reason_code: auditReason ?? code,
      error_code: code,
    };
  }
  if (code === "INVALID_ARGUMENT" || code === "ROUTER_INPUT_INVALID") {
    return {
      outcome: "validation_error",
      reason_code: auditReason ?? code,
      error_code: code,
    };
  }
  if (
    code === "IDEMPOTENCY_REPLAY_FAILURE" ||
    result.audit?.replayed === true
  ) {
    return {
      outcome: "replayed",
      reason_code: auditReason ?? code,
      error_code: code,
    };
  }
  if (code === "AUDIT_PERSISTENCE_FAILED") {
    return {
      outcome: "error",
      reason_code: auditReason ?? code,
      error_code: code,
    };
  }

  return {
    outcome: "blocked",
    reason_code: auditReason ?? code,
    error_code: code,
  };
}

/**
 * Construit l’entrée record depuis le résultat Router (+ audit attaché).
 * Champs sanitizés uniquement — pas d’args, output, secret, stack.
 */
export function buildObservabilityRecordInput(
  result: ToolRouteResult,
  now: string,
): ObservabilityRecordInput | null {
  const audit = result.audit;
  const mapped = mapOutcomeFromResult(result);

  const correlationId =
    result.correlation_id ??
    audit?.correlation_id ??
    undefined;
  const tenantId = audit?.tenant.tenant_id;
  if (!correlationId || !tenantId) {
    return null;
  }

  const input: ObservabilityRecordInput = {
    now,
    correlation_id: correlationId,
    tenant_id: tenantId,
    component: "tool_router",
    operation: "tool.route",
    outcome: mapped.outcome,
    severity: mapSeverity(mapped.outcome),
    duration_ms: audit?.duration_ms ?? 0,
  };

  const toolId = result.tool_id ?? audit?.tool.tool_id ?? undefined;
  const toolVersion =
    result.tool_version ?? audit?.tool.tool_version ?? undefined;
  if (toolId) input.tool_id = toolId;
  if (toolVersion) input.tool_version = toolVersion;
  if (audit?.mode) input.mode = audit.mode;
  if (audit?.autonomy.requested != null) {
    input.autonomy_level = audit.autonomy.requested;
  }
  if (audit?.resource?.kind) {
    input.resource_kind = audit.resource.kind;
  }
  if (mapped.reason_code) input.reason_code = mapped.reason_code;
  if (mapped.error_code) input.error_code = mapped.error_code;
  if (audit?.idempotency_status) {
    input.idempotency_status = audit.idempotency_status;
  }
  if (audit?.approval_status) {
    input.approval_status = audit.approval_status;
  }
  if (audit?.approval_required !== undefined) {
    input.approval_required = audit.approval_required;
  }
  if (audit?.approval_consumed !== undefined) {
    input.approval_consumed = audit.approval_consumed;
  }
  if (audit?.replayed !== undefined) {
    input.replayed = audit.replayed;
  }
  if (audit?.execution_outcome) {
    input.execution_outcome = audit.execution_outcome;
  }
  if (audit?.audit_id) {
    input.metadata = { audit_id: audit.audit_id };
  }

  return input;
}

/**
 * Enregistre au plus un ObservabilityEvent après l’issue audit.
 *
 * - Service omis → résultat inchangé.
 * - record() ok → attache `observability` (événement sanitizé).
 * - record() échoue / throw → conserve le résultat principal +
 *   `observability_degraded: true` (jamais de mutation status/error métier).
 */
export async function emitObservabilityOnResult(
  observabilityService: ObservabilityService | undefined | null,
  result: ToolRouteResult,
  now: string,
): Promise<ToolRouteResult> {
  if (!observabilityService) {
    return result;
  }

  const input = buildObservabilityRecordInput(result, now);
  if (!input) {
    return attachObservabilityDegraded(result);
  }

  try {
    const recorded = await observabilityService.record(input);
    if (!recorded.ok) {
      return attachObservabilityDegraded(result);
    }
    return attachObservability(result, recorded.event);
  } catch {
    return attachObservabilityDegraded(result);
  }
}
