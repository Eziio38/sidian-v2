/**
 * Construction locale d’AlertCandidate (G1-I).
 * Pas d’envoi, pas de notification, pas de texte libre sensible.
 * Horloge via `detected_at` injecté (depuis le signal) — jamais Date.now().
 */

import { createHash } from "node:crypto";

import type { AlertRecommendedActionCode } from "./reason-codes";
import type {
  AlertCandidate,
  SecuritySignal,
  SecuritySignalType,
} from "./types";

const ACTION_BY_SIGNAL: Record<
  SecuritySignalType,
  AlertRecommendedActionCode
> = {
  repeated_permission_denials: "REVIEW_PERMISSION_DENIALS",
  repeated_approval_replays: "REVIEW_APPROVAL_REPLAYS",
  idempotency_conflicts: "REVIEW_IDEMPOTENCY_CONFLICTS",
  executor_failures: "REVIEW_EXECUTOR_FAILURES",
  audit_persistence_failures: "REVIEW_AUDIT_PERSISTENCE",
  approval_consumed_without_execution: "REVIEW_APPROVAL_CONSUMPTION",
  indeterminate_execution_outcomes: "REVIEW_INDETERMINATE_OUTCOMES",
  invalid_argument_burst: "REVIEW_INVALID_ARGUMENTS",
  cross_tenant_scope_mismatch: "REVIEW_CROSS_TENANT_SCOPE",
  non_callable_tool_attempts: "REVIEW_NON_CALLABLE_TOOLS",
};

function deriveAlertCandidateId(signal: SecuritySignal): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        detected_at: signal.detected_at,
        signal_id: signal.signal_id,
        signal_type: signal.signal_type,
        tenant_id: signal.tenant_id,
        window_end: signal.window_end,
        window_start: signal.window_start,
      }),
      "utf8",
    )
    .digest("hex")
    .slice(0, 32);
  return `alc_${digest}`;
}

function deriveDeduplicationKey(signal: SecuritySignal): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        signal_type: signal.signal_type,
        tenant_id: signal.tenant_id,
        window_end: signal.window_end,
        window_start: signal.window_start,
      }),
      "utf8",
    )
    .digest("hex")
    .slice(0, 32);
  return `dedup_${signal.signal_type}_${signal.tenant_id}_${digest}`;
}

/**
 * Transforme un SecuritySignal en AlertCandidate local.
 * Evidence = identifiants uniquement — pas de payload.
 */
export function buildAlertCandidate(signal: SecuritySignal): AlertCandidate {
  return {
    alert_candidate_id: deriveAlertCandidateId(signal),
    tenant_id: signal.tenant_id,
    detected_at: signal.detected_at,
    signal_type: signal.signal_type,
    severity: signal.severity,
    reason_code: signal.reason_code,
    evidence_event_ids: [...signal.evidence_event_ids],
    recommended_action_code: ACTION_BY_SIGNAL[signal.signal_type],
    deduplication_key: deriveDeduplicationKey(signal),
    window_start: signal.window_start,
    window_end: signal.window_end,
  };
}

/**
 * Construit des AlertCandidate pour chaque signal — déterministe, sans I/O.
 */
export function buildAlertCandidates(
  signals: readonly SecuritySignal[],
): AlertCandidate[] {
  return signals.map(buildAlertCandidate);
}
