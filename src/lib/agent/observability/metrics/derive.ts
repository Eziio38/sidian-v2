/**
 * Dérivation pure de métriques G1-I.
 * Contrat service : `deriveMetrics({ event, events? }): MetricPoint[]`
 * Aucun état global caché.
 */

import { OBSERVABILITY_METRIC_NAMES } from "../reason-codes";
import type {
  DeriveMetricsInput,
  MetricPoint,
  ObservabilityEventLike,
  ObservabilityMetricName,
} from "./types";

const ROUTER_COMPONENTS = new Set(["tool_router"]);

const PERMISSION_DENIED_CODES = new Set([
  "PERMISSION_DENIED",
  "PERMISSION_MISSING",
  "MODE_NOT_ALLOWED",
  "AUTONOMY_EXCEEDED",
]);

const APPROVAL_REQUIRED_CODES = new Set([
  "APPROVAL_REQUIRED",
  "VALIDATION_REQUIRED",
  "VALIDATION_PENDING",
]);

const APPROVAL_REPLAY_CODES = new Set(["APPROVAL_ALREADY_CONSUMED"]);

const IDEMPOTENCY_CONFLICT_CODES = new Set(["IDEMPOTENCY_KEY_CONFLICT"]);

const IDEMPOTENCY_REPLAY_STATUSES = new Set([
  "replay_success",
  "replay_failure",
]);

const EXECUTOR_ERROR_CODES = new Set([
  "EXECUTOR_UNAVAILABLE",
  "EXECUTOR_TECHNICAL_ERROR",
  "EXECUTOR_BUSINESS_ERROR",
]);

const AUDIT_FAILURE_CODES = new Set(["AUDIT_PERSISTENCE_FAILED"]);

const INDETERMINATE_CODES = new Set(["IDEMPOTENCY_COMPLETION_FAILED"]);

const APPROVAL_CONSUMED_CODES = new Set([
  "APPROVAL_CONSUMED_EXECUTION_NOT_STARTED",
]);

function codesOf(event: ObservabilityEventLike): Set<string> {
  const codes = new Set<string>();
  if (typeof event.reason_code === "string" && event.reason_code.length > 0) {
    codes.add(event.reason_code);
  }
  if (typeof event.error_code === "string" && event.error_code.length > 0) {
    codes.add(event.error_code);
  }
  return codes;
}

function hasCode(
  event: ObservabilityEventLike,
  set: ReadonlySet<string>,
): boolean {
  const codes = codesOf(event);
  for (const c of codes) {
    if (set.has(c)) return true;
  }
  return false;
}

function isRouterEvent(event: ObservabilityEventLike): boolean {
  if (event.component == null || event.component === "") {
    return true;
  }
  return ROUTER_COMPONENTS.has(event.component);
}

function counter(
  name: ObservabilityMetricName,
  value: number,
  occurred_at: string,
): MetricPoint {
  return { name, value, kind: "counter", unit: "1", occurred_at };
}

function isPermissionDenied(event: ObservabilityEventLike): boolean {
  return (
    event.outcome === "denied" || hasCode(event, PERMISSION_DENIED_CODES)
  );
}

function isApprovalRequired(event: ObservabilityEventLike): boolean {
  return (
    event.outcome === "approval_required" ||
    event.approval_required === true ||
    hasCode(event, APPROVAL_REQUIRED_CODES)
  );
}

function isApprovalReplay(event: ObservabilityEventLike): boolean {
  return (
    hasCode(event, APPROVAL_REPLAY_CODES) ||
    event.approval_status === "already_consumed"
  );
}

function isApprovalConsumed(event: ObservabilityEventLike): boolean {
  return (
    event.approval_consumed === true ||
    event.approval_status === "consumed" ||
    hasCode(event, APPROVAL_CONSUMED_CODES)
  );
}

function isIdempotencyConflict(event: ObservabilityEventLike): boolean {
  return (
    event.idempotency_status === "conflict" ||
    hasCode(event, IDEMPOTENCY_CONFLICT_CODES)
  );
}

function isIdempotencyReplay(event: ObservabilityEventLike): boolean {
  return (
    event.execution_outcome === "replayed" ||
    event.outcome === "replayed" ||
    (typeof event.idempotency_status === "string" &&
      IDEMPOTENCY_REPLAY_STATUSES.has(event.idempotency_status)) ||
    (event.replayed === true &&
      typeof event.idempotency_status === "string" &&
      event.idempotency_status.length > 0)
  );
}

function isExecutorError(event: ObservabilityEventLike): boolean {
  return hasCode(event, EXECUTOR_ERROR_CODES);
}

function isAuditPersistenceFailure(event: ObservabilityEventLike): boolean {
  return hasCode(event, AUDIT_FAILURE_CODES);
}

function isIndeterminate(event: ObservabilityEventLike): boolean {
  return (
    event.execution_outcome === "indeterminate" ||
    event.idempotency_status === "completion_failed" ||
    hasCode(event, INDETERMINATE_CODES)
  );
}

function isBlocked(event: ObservabilityEventLike): boolean {
  return (
    event.outcome === "blocked" ||
    event.outcome === "denied" ||
    event.outcome === "approval_required" ||
    event.outcome === "validation_error"
  );
}

/**
 * Agrège les métriques sur une liste d’événements.
 */
export function deriveMetricsFromEvents(
  events: readonly ObservabilityEventLike[],
): MetricPoint[] {
  let router_requests_total = 0;
  let router_success_total = 0;
  let router_blocked_total = 0;
  let permission_denied_total = 0;
  let approval_required_total = 0;
  let approval_consumed_total = 0;
  let approval_replay_total = 0;
  let idempotency_conflict_total = 0;
  let idempotency_replay_total = 0;
  let executor_error_total = 0;
  let audit_persistence_failure_total = 0;
  let indeterminate_outcome_total = 0;

  let latestAt = "";
  const durationPoints: MetricPoint[] = [];

  for (const event of events) {
    if (event.occurred_at > latestAt) {
      latestAt = event.occurred_at;
    }

    if (isAuditPersistenceFailure(event)) {
      audit_persistence_failure_total += 1;
    }

    if (!isRouterEvent(event)) {
      continue;
    }

    router_requests_total += 1;

    if (event.outcome === "success") {
      router_success_total += 1;
    }
    if (isBlocked(event)) {
      router_blocked_total += 1;
    }
    if (isPermissionDenied(event)) {
      permission_denied_total += 1;
    }
    if (isApprovalRequired(event)) {
      approval_required_total += 1;
    }
    if (isApprovalConsumed(event)) {
      approval_consumed_total += 1;
    }
    if (isApprovalReplay(event)) {
      approval_replay_total += 1;
    }
    if (isIdempotencyConflict(event)) {
      idempotency_conflict_total += 1;
    }
    if (isIdempotencyReplay(event)) {
      idempotency_replay_total += 1;
    }
    if (isExecutorError(event)) {
      executor_error_total += 1;
    }
    if (isIndeterminate(event)) {
      indeterminate_outcome_total += 1;
    }

    if (
      typeof event.duration_ms === "number" &&
      Number.isFinite(event.duration_ms) &&
      event.duration_ms >= 0
    ) {
      durationPoints.push({
        name: "route_duration_ms",
        value: event.duration_ms,
        kind: "histogram",
        unit: "ms",
        occurred_at: event.occurred_at,
      });
    }
  }

  const occurred_at = latestAt || "1970-01-01T00:00:00.000Z";

  const counters: MetricPoint[] = [
    counter("router_requests_total", router_requests_total, occurred_at),
    counter("router_success_total", router_success_total, occurred_at),
    counter("router_blocked_total", router_blocked_total, occurred_at),
    counter("permission_denied_total", permission_denied_total, occurred_at),
    counter("approval_required_total", approval_required_total, occurred_at),
    counter("approval_consumed_total", approval_consumed_total, occurred_at),
    counter("approval_replay_total", approval_replay_total, occurred_at),
    counter(
      "idempotency_conflict_total",
      idempotency_conflict_total,
      occurred_at,
    ),
    counter("idempotency_replay_total", idempotency_replay_total, occurred_at),
    counter("executor_error_total", executor_error_total, occurred_at),
    counter(
      "audit_persistence_failure_total",
      audit_persistence_failure_total,
      occurred_at,
    ),
    counter(
      "indeterminate_outcome_total",
      indeterminate_outcome_total,
      occurred_at,
    ),
  ];

  return [...counters, ...durationPoints];
}

/**
 * Contrat service Task A / DeriveMetricsFn.
 */
export function deriveMetrics(input: DeriveMetricsInput): MetricPoint[] {
  const source =
    input.events && input.events.length > 0 ? input.events : [input.event];
  return deriveMetricsFromEvents(source);
}

export function deriveMetricsFromEvent(
  event: ObservabilityEventLike,
): MetricPoint[] {
  return deriveMetricsFromEvents([event]);
}

export function isKnownMetricName(
  name: string,
): name is ObservabilityMetricName {
  return (OBSERVABILITY_METRIC_NAMES as readonly string[]).includes(name);
}
