/**
 * Tests G1-I — métriques déterministes (cas 12–19).
 */

import { describe, expect, it } from "vitest";

import {
  deriveMetrics,
  deriveMetricsFromEvents,
} from "@/lib/agent/observability/metrics";

import {
  approvalReplayEvent,
  auditFailureEvent,
  expectMetricValue,
  expectNoSensitiveLeak,
  executorFailureEvent,
  idempotencyConflictEvent,
  indeterminateEvent,
  makeEvent,
  permissionDeniedEvent,
} from "./test-fixtures";

describe("Observability G1-I — metrics", () => {
  it("12. métrique succès — router_success_total", () => {
    const event = makeEvent({
      outcome: "success",
      reason_code: "SUCCESS",
      duration_ms: 8,
    });
    const metrics = deriveMetricsFromEvents([event]);

    expectMetricValue(metrics, "router_requests_total", 1);
    expectMetricValue(metrics, "router_success_total", 1);
    expectMetricValue(metrics, "router_blocked_total", 0);
    expect(
      metrics.some((m) => m.name === "route_duration_ms" && m.value === 8),
    ).toBe(true);
    // Contrat objet aussi supporté
    expect(
      deriveMetrics({ event, events: [event] }).find(
        (m) => m.name === "router_success_total",
      )?.value,
    ).toBe(1);
    expectNoSensitiveLeak(metrics);
  });

  it("13. métrique blocked — router_blocked_total", () => {
    const event = makeEvent({
      outcome: "blocked",
      reason_code: "VALIDATION_REQUIRED",
    });
    const metrics = deriveMetricsFromEvents([event]);

    expectMetricValue(metrics, "router_requests_total", 1);
    expectMetricValue(metrics, "router_blocked_total", 1);
    expectMetricValue(metrics, "router_success_total", 0);
  });

  it("14. métrique permission denied", () => {
    const metrics = deriveMetricsFromEvents([
      permissionDeniedEvent(),
      permissionDeniedEvent({ event_id: "deny_2" }),
    ]);

    expectMetricValue(metrics, "permission_denied_total", 2);
    expectMetricValue(metrics, "router_blocked_total", 2);
  });

  it("15. métrique approval replay", () => {
    const metrics = deriveMetricsFromEvents([
      approvalReplayEvent(),
      approvalReplayEvent({ event_id: "apr_2" }),
    ]);

    expectMetricValue(metrics, "approval_replay_total", 2);
  });

  it("16. métrique idempotency conflict", () => {
    const metrics = deriveMetricsFromEvents([
      idempotencyConflictEvent(),
      idempotencyConflictEvent({ event_id: "idc_2" }),
      idempotencyConflictEvent({ event_id: "idc_3" }),
    ]);

    expectMetricValue(metrics, "idempotency_conflict_total", 3);
  });

  it("17. métrique executor error", () => {
    const metrics = deriveMetricsFromEvents([
      executorFailureEvent(),
      executorFailureEvent({
        event_id: "ex_2",
        reason_code: "EXECUTOR_BUSINESS_ERROR",
        error_code: "EXECUTOR_BUSINESS_ERROR",
      }),
    ]);

    expectMetricValue(metrics, "executor_error_total", 2);
  });

  it("18. métrique audit failure", () => {
    const metrics = deriveMetricsFromEvents([
      auditFailureEvent(),
      makeEvent({ outcome: "success", reason_code: "SUCCESS" }),
    ]);

    expectMetricValue(metrics, "audit_persistence_failure_total", 1);
    expectMetricValue(metrics, "router_requests_total", 1);
  });

  it("19. métrique indeterminate", () => {
    const metrics = deriveMetricsFromEvents([
      indeterminateEvent(),
      indeterminateEvent({ event_id: "ind_2" }),
    ]);

    expectMetricValue(metrics, "indeterminate_outcome_total", 2);
  });
});
