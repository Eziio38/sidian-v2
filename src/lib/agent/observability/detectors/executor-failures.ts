/**
 * Détecteur : échecs exécuteur répétés.
 */

import { detectPerTenant, hasAnyCode } from "./helpers";
import { resolveThreshold } from "./thresholds";
import type {
  DetectorOptions,
  DetectionWindow,
  ObservabilityEventLike,
  SecuritySignal,
} from "./types";

const MATCH_CODES = [
  "EXECUTOR_UNAVAILABLE",
  "EXECUTOR_TECHNICAL_ERROR",
  "EXECUTOR_BUSINESS_ERROR",
] as const;

export function detectExecutorFailures(
  events: readonly ObservabilityEventLike[],
  window: DetectionWindow,
  options?: DetectorOptions,
): SecuritySignal[] {
  const threshold = resolveThreshold("executor_failures", options?.threshold);
  return detectPerTenant({
    events,
    window,
    threshold,
    signal_type: "executor_failures",
    severity: "error",
    reason_code: "EXECUTOR_FAILURES",
    detected_at: options?.now ?? window.end,
    match: (event) => hasAnyCode(event, MATCH_CODES),
  });
}
