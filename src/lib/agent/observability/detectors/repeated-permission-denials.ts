/**
 * Détecteur : refus de permission répétés dans la fenêtre.
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
  "PERMISSION_DENIED",
  "PERMISSION_MISSING",
  "MODE_NOT_ALLOWED",
  "AUTONOMY_EXCEEDED",
] as const;

export function detectRepeatedPermissionDenials(
  events: readonly ObservabilityEventLike[],
  window: DetectionWindow,
  options?: DetectorOptions,
): SecuritySignal[] {
  const threshold = resolveThreshold(
    "repeated_permission_denials",
    options?.threshold,
  );
  return detectPerTenant({
    events,
    window,
    threshold,
    signal_type: "repeated_permission_denials",
    severity: "warning",
    reason_code: "REPEATED_PERMISSION_DENIALS",
    detected_at: options?.now ?? window.end,
    match: (event) =>
      event.outcome === "denied" || hasAnyCode(event, MATCH_CODES),
  });
}
