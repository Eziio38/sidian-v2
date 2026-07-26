/**
 * Détecteur : approbation consommée sans démarrage d’exécution.
 */

import { detectPerTenant, hasAnyCode } from "./helpers";
import { resolveThreshold } from "./thresholds";
import type {
  DetectorOptions,
  DetectionWindow,
  ObservabilityEventLike,
  SecuritySignal,
} from "./types";

const MATCH_CODES = ["APPROVAL_CONSUMED_EXECUTION_NOT_STARTED"] as const;

export function detectApprovalConsumedWithoutExecution(
  events: readonly ObservabilityEventLike[],
  window: DetectionWindow,
  options?: DetectorOptions,
): SecuritySignal[] {
  const threshold = resolveThreshold(
    "approval_consumed_without_execution",
    options?.threshold,
  );
  return detectPerTenant({
    events,
    window,
    threshold,
    signal_type: "approval_consumed_without_execution",
    severity: "error",
    reason_code: "APPROVAL_CONSUMED_WITHOUT_EXECUTION",
    detected_at: options?.now ?? window.end,
    match: (event) =>
      hasAnyCode(event, MATCH_CODES) ||
      (event.approval_consumed === true &&
        event.execution_outcome === "not_started"),
  });
}
