/**
 * Détecteur : rafale d’arguments invalides.
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
  "INVALID_ARGUMENT",
  "ROUTER_INPUT_INVALID",
  "INPUT_INVALID",
  "INPUT_SCHEMA_UNRESOLVED",
] as const;

export function detectInvalidArgumentBurst(
  events: readonly ObservabilityEventLike[],
  window: DetectionWindow,
  options?: DetectorOptions,
): SecuritySignal[] {
  const threshold = resolveThreshold(
    "invalid_argument_burst",
    options?.threshold,
  );
  return detectPerTenant({
    events,
    window,
    threshold,
    signal_type: "invalid_argument_burst",
    severity: "warning",
    reason_code: "INVALID_ARGUMENT_BURST",
    detected_at: options?.now ?? window.end,
    match: (event) =>
      event.outcome === "validation_error" || hasAnyCode(event, MATCH_CODES),
  });
}
