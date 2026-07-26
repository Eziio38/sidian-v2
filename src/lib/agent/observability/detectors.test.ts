/**
 * Tests G1-I — détecteurs / déterminisme / evidence / tenant (cas 20–34).
 *
 * Importe les détecteurs purs `@/lib/agent/observability/detectors`.
 * Fenêtre et seuils injectés — jamais Date.now().
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_DETECTOR_THRESHOLDS,
  detectApprovalConsumedWithoutExecution,
  detectAuditPersistenceFailures,
  detectCrossTenantScopeMismatch,
  detectExecutorFailures,
  detectIdempotencyConflicts,
  detectIndeterminateExecutionOutcomes,
  detectInvalidArgumentBurst,
  detectNonCallableToolAttempts,
  detectRepeatedApprovalReplays,
  detectRepeatedPermissionDenials,
} from "@/lib/agent/observability/detectors";
import { buildAlertCandidate } from "@/lib/agent/observability";

import {
  TENANT_A,
  TENANT_B,
  TEST_THRESHOLD_BURST,
  TEST_THRESHOLD_SINGLE,
  WINDOW_END,
  approvalConsumedWithoutExecutionEvent,
  approvalReplayEvent,
  auditFailureEvent,
  burstPermissionDenials,
  crossTenantEvent,
  defaultWindow,
  expectEvidenceIdsOnly,
  expectNoNeighborTenantLeak,
  expectNoSensitiveLeak,
  executorFailureEvent,
  idempotencyConflictEvent,
  indeterminateEvent,
  invalidArgumentEvent,
  makeEvent,
  neighborTenantDeniedEvent,
  nonCallableEvent,
  permissionDeniedEvent,
} from "./test-fixtures";

describe("Observability G1-I — detectors", () => {
  const window = defaultWindow();

  it("20. repeated_permission_denials déclenché au seuil", () => {
    const events = burstPermissionDenials(TEST_THRESHOLD_BURST);
    const signals = detectRepeatedPermissionDenials(events, window, {
      threshold: TEST_THRESHOLD_BURST,
    });

    expect(signals).toHaveLength(1);
    expect(signals[0]?.signal_type).toBe("repeated_permission_denials");
    expect(signals[0]?.reason_code).toBe("REPEATED_PERMISSION_DENIALS");
    expect(signals[0]?.count).toBe(TEST_THRESHOLD_BURST);
    expect(signals[0]?.detected_at).toBe(WINDOW_END);
    expectEvidenceIdsOnly(signals[0]!);
  });

  it("21. pas de signal sous le seuil", () => {
    const events = burstPermissionDenials(TEST_THRESHOLD_BURST - 1);
    const signals = detectRepeatedPermissionDenials(events, window, {
      threshold: TEST_THRESHOLD_BURST,
    });
    expect(signals).toHaveLength(0);
  });

  it("22. repeated_approval_replays déclenché", () => {
    const events = [
      approvalReplayEvent({ event_id: "apr_1" }),
      approvalReplayEvent({ event_id: "apr_2" }),
      approvalReplayEvent({ event_id: "apr_3" }),
    ];
    const signals = detectRepeatedApprovalReplays(events, window, {
      threshold: DEFAULT_DETECTOR_THRESHOLDS.repeated_approval_replays,
    });
    expect(signals).toHaveLength(1);
    expect(signals[0]?.signal_type).toBe("repeated_approval_replays");
    expect(signals[0]?.reason_code).toBe("REPEATED_APPROVAL_REPLAYS");
  });

  it("23. idempotency_conflicts déclenché", () => {
    const events = [
      idempotencyConflictEvent({ event_id: "c1" }),
      idempotencyConflictEvent({ event_id: "c2" }),
      idempotencyConflictEvent({ event_id: "c3" }),
    ];
    const signals = detectIdempotencyConflicts(events, window, {
      threshold: DEFAULT_DETECTOR_THRESHOLDS.idempotency_conflicts,
    });
    expect(signals).toHaveLength(1);
    expect(signals[0]?.signal_type).toBe("idempotency_conflicts");
  });

  it("24. executor_failures déclenché", () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      executorFailureEvent({ event_id: `ex_${i}` }),
    );
    const signals = detectExecutorFailures(events, window, {
      threshold: DEFAULT_DETECTOR_THRESHOLDS.executor_failures,
    });
    expect(signals).toHaveLength(1);
    expect(signals[0]?.signal_type).toBe("executor_failures");
  });

  it("25. approval_consumed_without_execution déclenché", () => {
    const events = [approvalConsumedWithoutExecutionEvent()];
    const signals = detectApprovalConsumedWithoutExecution(events, window, {
      threshold: TEST_THRESHOLD_SINGLE,
    });
    expect(signals).toHaveLength(1);
    expect(signals[0]?.signal_type).toBe(
      "approval_consumed_without_execution",
    );
  });

  it("26. indeterminate_execution_outcomes déclenché", () => {
    const events = [indeterminateEvent()];
    const signals = detectIndeterminateExecutionOutcomes(events, window, {
      threshold: TEST_THRESHOLD_SINGLE,
    });
    expect(signals).toHaveLength(1);
    expect(signals[0]?.signal_type).toBe("indeterminate_execution_outcomes");
  });

  it("27. invalid_argument_burst déclenché", () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      invalidArgumentEvent({ event_id: `inv_${i}` }),
    );
    const signals = detectInvalidArgumentBurst(events, window, {
      threshold: DEFAULT_DETECTOR_THRESHOLDS.invalid_argument_burst,
    });
    expect(signals).toHaveLength(1);
    expect(signals[0]?.signal_type).toBe("invalid_argument_burst");
  });

  it("28. cross_tenant_scope_mismatch déclenché", () => {
    const events = [crossTenantEvent()];
    const signals = detectCrossTenantScopeMismatch(events, window, {
      threshold: TEST_THRESHOLD_SINGLE,
    });
    expect(signals).toHaveLength(1);
    expect(signals[0]?.signal_type).toBe("cross_tenant_scope_mismatch");
    expect(signals[0]?.severity).toBe("critical");
  });

  it("29. non_callable_tool_attempts déclenché", () => {
    const events = [
      nonCallableEvent({ event_id: "nc_1" }),
      nonCallableEvent({ event_id: "nc_2" }),
      nonCallableEvent({ event_id: "nc_3" }),
    ];
    const signals = detectNonCallableToolAttempts(events, window, {
      threshold: DEFAULT_DETECTOR_THRESHOLDS.non_callable_tool_attempts,
    });
    expect(signals).toHaveLength(1);
    expect(signals[0]?.signal_type).toBe("non_callable_tool_attempts");
  });

  it("30. déterminisme — même input + même fenêtre → mêmes signaux", () => {
    const events = burstPermissionDenials(TEST_THRESHOLD_BURST);
    const a = detectRepeatedPermissionDenials(events, window, {
      threshold: TEST_THRESHOLD_BURST,
    });
    const b = detectRepeatedPermissionDenials(
      structuredClone(events),
      { ...window },
      { threshold: TEST_THRESHOLD_BURST },
    );
    expect(a).toEqual(b);
  });

  it("31. ordre des événements indépendant", () => {
    const base = [
      idempotencyConflictEvent({ event_id: "z_last" }),
      idempotencyConflictEvent({ event_id: "a_first" }),
      idempotencyConflictEvent({ event_id: "m_mid" }),
    ];
    const reversed = [...base].reverse();

    const a = detectIdempotencyConflicts(base, window, { threshold: 3 });
    const b = detectIdempotencyConflicts(reversed, window, { threshold: 3 });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]?.signal_id).toBe(b[0]?.signal_id);
    expect(a[0]?.evidence_event_ids).toEqual(b[0]?.evidence_event_ids);
  });

  it("32. evidence references sans payload", () => {
    const events = [
      auditFailureEvent({ event_id: "aud_fail_1" }),
    ];
    const signals = detectAuditPersistenceFailures(events, window, {
      threshold: TEST_THRESHOLD_SINGLE,
    });
    expect(signals).toHaveLength(1);
    expectEvidenceIdsOnly(signals[0]!);
    expect(signals[0]?.evidence_event_ids).toEqual(["aud_fail_1"]);
  });

  it("33. severity cohérente + AlertCandidate local", () => {
    const signals = detectCrossTenantScopeMismatch(
      [crossTenantEvent({ event_id: "xt_1" })],
      window,
      { threshold: 1 },
    );
    expect(signals[0]?.severity).toBe("critical");

    // Friction : detectors n’ajoutent pas toujours `threshold` au signal.
    const adapted = {
      ...signals[0]!,
      evidence_event_ids: [...signals[0]!.evidence_event_ids],
      threshold: signals[0]!.threshold ?? 1,
    };
    const alert = buildAlertCandidate(adapted);
    expect(alert.signal_type).toBe("cross_tenant_scope_mismatch");
    expect(alert.recommended_action_code).toBe("REVIEW_CROSS_TENANT_SCOPE");
    expect(alert.evidence_event_ids).toEqual(["xt_1"]);
    expect(alert.deduplication_key.length).toBeGreaterThan(0);
    expectNoSensitiveLeak(alert);
  });

  it("34. aucune fuite de tenant voisin", () => {
    const events = [
      ...burstPermissionDenials(TEST_THRESHOLD_BURST, TENANT_A),
      neighborTenantDeniedEvent({ event_id: "deny_b_1" }),
      neighborTenantDeniedEvent({ event_id: "deny_b_2" }),
      makeEvent({
        event_id: "ok_a",
        tenant_id: TENANT_A,
        outcome: "success",
      }),
    ];

    const signals = detectRepeatedPermissionDenials(events, window, {
      threshold: TEST_THRESHOLD_BURST,
    });

    expect(signals).toHaveLength(1);
    expect(signals[0]?.tenant_id).toBe(TENANT_A);
    expectNoNeighborTenantLeak(signals[0]!, TENANT_A);

    // Tenant B sous le seuil → pas de signal B.
    expect(signals.every((s) => s.tenant_id !== TENANT_B)).toBe(true);
  });
});
