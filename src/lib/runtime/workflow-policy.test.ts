import { describe, expect, it } from "vitest";

import {
  REJECTED_LEGACY_ENROLLMENT_OFFSETS_DAYS,
  WORKFLOW_POLICY,
  WORKFLOW_POLICY_VERSION,
  addUtcDays,
  buildJobIdempotencyKey,
  isDueReached,
  isInPreventionWindow,
  isSilenceWindowReached,
  resolveSilenceGraceDays,
} from "./workflow-policy";

describe("workflow-policy V2 calendar", () => {
  it("exposes a versioned single source of timing rules", () => {
    expect(WORKFLOW_POLICY.version).toBe(WORKFLOW_POLICY_VERSION);
    expect(WORKFLOW_POLICY.prevention.daysBeforeDue).toBe(5);
    expect(WORKFLOW_POLICY.due.dayOffsetFromDue).toBe(0);
    expect(WORKFLOW_POLICY.retries.policy).toBe("none");
  });

  it("does not encode legacy enrollment offsets J+5/9/10/15/17 as active rules", () => {
    // La prévention utilise J-5 (daysBeforeDue), ce n’est pas J+5 legacy.
    expect(WORKFLOW_POLICY.prevention.daysBeforeDue).toBe(5);
    expect(WORKFLOW_POLICY.due.dayOffsetFromDue).not.toBe(5);
    for (const offset of REJECTED_LEGACY_ENROLLMENT_OFFSETS_DAYS) {
      expect(WORKFLOW_POLICY.due.dayOffsetFromDue).not.toBe(offset);
      // silence défaut ≠ offsets d’enrôlement V1 (sauf coïncidence documentée)
      if (offset !== 5) {
        expect(WORKFLOW_POLICY.silence.defaultGraceDaysAfterDue).not.toBe(
          offset,
        );
      }
    }
    // J+5 legacy ≠ fenêtre préventive J-5 : sémantique inverse, documentée.
    expect(WORKFLOW_POLICY.silence.defaultGraceDaysAfterDue).toBe(14);
  });

  it("prevention window is [due-5, due-1]", () => {
    expect(
      isInPreventionWindow({ dueDate: "2026-08-10", today: "2026-08-05" }),
    ).toBe(true);
    expect(
      isInPreventionWindow({ dueDate: "2026-08-10", today: "2026-08-09" }),
    ).toBe(true);
    expect(
      isInPreventionWindow({ dueDate: "2026-08-10", today: "2026-08-04" }),
    ).toBe(false);
    expect(
      isInPreventionWindow({ dueDate: "2026-08-10", today: "2026-08-10" }),
    ).toBe(false);
  });

  it("due is reached on day J", () => {
    expect(isDueReached({ dueDate: "2026-08-10", today: "2026-08-10" })).toBe(
      true,
    );
    expect(isDueReached({ dueDate: "2026-08-10", today: "2026-08-09" })).toBe(
      false,
    );
  });

  it("silence uses grace days from anchor, not legacy J+N enrollment", () => {
    expect(
      isSilenceWindowReached({
        dueDate: "2026-08-10",
        today: "2026-08-24",
        graceDays: 14,
      }),
    ).toBe(true);
    expect(
      isSilenceWindowReached({
        dueDate: "2026-08-10",
        today: "2026-08-23",
        graceDays: 14,
      }),
    ).toBe(false);
    expect(resolveSilenceGraceDays(null)).toBe(14);
    expect(resolveSilenceGraceDays(7)).toBe(7);
    expect(resolveSilenceGraceDays(1)).toBe(3); // clamp min
  });

  it("builds stable idempotency keys", () => {
    expect(
      buildJobIdempotencyKey({
        jobKind: "prevention_notice",
        creanceId: "c1",
        occurrenceKey: "2026-08-10",
      }),
    ).toBe("prevention_notice:c1:2026-08-10");
    expect(addUtcDays("2026-08-10", -5)).toBe("2026-08-05");
  });
});
