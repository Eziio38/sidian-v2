/**
 * Détecteur : échecs de persistance d’audit.
 */

import { detectPerTenant, hasAnyCode } from "./helpers";
import { resolveThreshold } from "./thresholds";
import type {
  DetectorOptions,
  DetectionWindow,
  ObservabilityEventLike,
  SecuritySignal,
} from "./types";

const MATCH_CODES = ["AUDIT_PERSISTENCE_FAILED"] as const;

export function detectAuditPersistenceFailures(
  events: readonly ObservabilityEventLike[],
  window: DetectionWindow,
  options?: DetectorOptions,
): SecuritySignal[] {
  const threshold = resolveThreshold(
    "audit_persistence_failures",
    options?.threshold,
  );
  return detectPerTenant({
    events,
    window,
    threshold,
    signal_type: "audit_persistence_failures",
    severity: "error",
    reason_code: "AUDIT_PERSISTENCE_FAILURES",
    detected_at: options?.now ?? window.end,
    match: (event) => hasAnyCode(event, MATCH_CODES),
  });
}
