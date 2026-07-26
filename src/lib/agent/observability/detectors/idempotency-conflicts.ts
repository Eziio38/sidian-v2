/**
 * Détecteur : conflits d’idempotence dans la fenêtre.
 */

import { detectPerTenant, hasAnyCode } from "./helpers";
import { resolveThreshold } from "./thresholds";
import type {
  DetectorOptions,
  DetectionWindow,
  ObservabilityEventLike,
  SecuritySignal,
} from "./types";

const MATCH_CODES = ["IDEMPOTENCY_KEY_CONFLICT"] as const;

export function detectIdempotencyConflicts(
  events: readonly ObservabilityEventLike[],
  window: DetectionWindow,
  options?: DetectorOptions,
): SecuritySignal[] {
  const threshold = resolveThreshold(
    "idempotency_conflicts",
    options?.threshold,
  );
  return detectPerTenant({
    events,
    window,
    threshold,
    signal_type: "idempotency_conflicts",
    severity: "error",
    reason_code: "IDEMPOTENCY_CONFLICTS",
    detected_at: options?.now ?? window.end,
    match: (event) =>
      event.idempotency_status === "conflict" ||
      hasAnyCode(event, MATCH_CODES),
  });
}
