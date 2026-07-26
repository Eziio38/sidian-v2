/**
 * Détecteur : tentatives d’appel d’outil non appelable / inconnu.
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
  "TOOL_NOT_CALLABLE",
  "TOOL_UNKNOWN",
  "TOOL_UNRESOLVED",
] as const;

export function detectNonCallableToolAttempts(
  events: readonly ObservabilityEventLike[],
  window: DetectionWindow,
  options?: DetectorOptions,
): SecuritySignal[] {
  const threshold = resolveThreshold(
    "non_callable_tool_attempts",
    options?.threshold,
  );
  return detectPerTenant({
    events,
    window,
    threshold,
    signal_type: "non_callable_tool_attempts",
    severity: "warning",
    reason_code: "NON_CALLABLE_TOOL_ATTEMPTS",
    detected_at: options?.now ?? window.end,
    match: (event) => hasAnyCode(event, MATCH_CODES),
  });
}
