/**
 * Détecteur : rejeux d’approbation répétés (déjà consommée / replay).
 */

import { detectPerTenant, hasAnyCode } from "./helpers";
import { resolveThreshold } from "./thresholds";
import type {
  DetectorOptions,
  DetectionWindow,
  ObservabilityEventLike,
  SecuritySignal,
} from "./types";

const MATCH_CODES = ["APPROVAL_ALREADY_CONSUMED"] as const;

export function detectRepeatedApprovalReplays(
  events: readonly ObservabilityEventLike[],
  window: DetectionWindow,
  options?: DetectorOptions,
): SecuritySignal[] {
  const threshold = resolveThreshold(
    "repeated_approval_replays",
    options?.threshold,
  );
  return detectPerTenant({
    events,
    window,
    threshold,
    signal_type: "repeated_approval_replays",
    severity: "warning",
    reason_code: "REPEATED_APPROVAL_REPLAYS",
    detected_at: options?.now ?? window.end,
    match: (event) =>
      hasAnyCode(event, MATCH_CODES) ||
      event.approval_status === "already_consumed" ||
      (event.replayed === true &&
        (event.approval_status != null ||
          event.component === "approval" ||
          hasAnyCode(event, ["APPROVAL_REQUIRED", "VALIDATION_REQUIRED"]))),
  });
}
