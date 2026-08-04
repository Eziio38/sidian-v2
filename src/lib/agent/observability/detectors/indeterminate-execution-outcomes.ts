/**
 * Détecteur : issues d’exécution indéterminées.
 */

import { detectPerTenant, hasAnyCode } from "./helpers";
import { resolveThreshold } from "./thresholds";
import type {
  DetectorOptions,
  DetectionWindow,
  ObservabilityEventLike,
  SecuritySignal,
} from "./types";

const MATCH_CODES = ["IDEMPOTENCY_COMPLETION_FAILED"] as const;

export function detectIndeterminateExecutionOutcomes(
  events: readonly ObservabilityEventLike[],
  window: DetectionWindow,
  options?: DetectorOptions,
): SecuritySignal[] {
  const threshold = resolveThreshold(
    "indeterminate_execution_outcomes",
    options?.threshold,
  );
  return detectPerTenant({
    events,
    window,
    threshold,
    signal_type: "indeterminate_execution_outcomes",
    severity: "error",
    reason_code: "INDETERMINATE_EXECUTION_OUTCOMES",
    detected_at: options?.now ?? window.end,
    match: (event) =>
      event.execution_outcome === "indeterminate" ||
      event.idempotency_status === "completion_failed" ||
      hasAnyCode(event, MATCH_CODES),
  });
}
