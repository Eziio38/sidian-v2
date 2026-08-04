/**
 * Détecteur : tentatives de scope mismatch (cross-tenant / ressource).
 * Sévérité critique — AlertCandidate locale uniquement (pas d’envoi).
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
  "TENANT_SCOPE_MISMATCH",
  "RESOURCE_SCOPE_MISMATCH",
  "APPROVAL_SCOPE_MISMATCH",
  "VALIDATION_SCOPE_MISMATCH",
] as const;

export function detectCrossTenantScopeMismatch(
  events: readonly ObservabilityEventLike[],
  window: DetectionWindow,
  options?: DetectorOptions,
): SecuritySignal[] {
  const threshold = resolveThreshold(
    "cross_tenant_scope_mismatch",
    options?.threshold,
  );
  return detectPerTenant({
    events,
    window,
    threshold,
    signal_type: "cross_tenant_scope_mismatch",
    severity: "critical",
    reason_code: "CROSS_TENANT_SCOPE_MISMATCH",
    detected_at: options?.now ?? window.end,
    match: (event) => hasAnyCode(event, MATCH_CODES),
  });
}
