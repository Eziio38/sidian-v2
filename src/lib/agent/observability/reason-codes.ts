/**
 * Codes stables du modèle d’observabilité agent (G1-I).
 * Messages sûrs — jamais de stack, SQL, secret, payload ou détail fournisseur.
 */

/** Codes d’erreur / statut exposables par le service. */
export const OBSERVABILITY_ERROR_CODES = [
  "OBSERVABILITY_INPUT_INVALID",
  "EVENT_BUILD_FAILED",
  "SINK_UNAVAILABLE",
  "SINK_FAILED",
  "SECURITY_SIGNAL_DETECTED",
  "METRIC_DERIVATION_FAILED",
] as const;

export type ObservabilityErrorCode =
  (typeof OBSERVABILITY_ERROR_CODES)[number];

/** Messages applicatifs stables. */
export const OBSERVABILITY_SAFE_MESSAGES = {
  OBSERVABILITY_INPUT_INVALID:
    "Entrée d’observabilité invalide ou champs interdits (schéma strict).",
  EVENT_BUILD_FAILED:
    "Échec de construction de l’événement d’observabilité.",
  SINK_UNAVAILABLE: "Sink d’observabilité indisponible.",
  SINK_FAILED: "Échec d’enregistrement dans le sink d’observabilité.",
  SECURITY_SIGNAL_DETECTED:
    "Un ou plusieurs signaux de sécurité ont été détectés.",
  METRIC_DERIVATION_FAILED: "Échec de dérivation des métriques d’observabilité.",
} as const satisfies Record<ObservabilityErrorCode, string>;

/**
 * Types de signaux de sécurité (détecteurs G1-I — Task B).
 * Identifiants stables — pas de texte libre.
 */
export const SECURITY_SIGNAL_TYPES = [
  "repeated_permission_denials",
  "repeated_approval_replays",
  "idempotency_conflicts",
  "executor_failures",
  "audit_persistence_failures",
  "approval_consumed_without_execution",
  "indeterminate_execution_outcomes",
  "invalid_argument_burst",
  "cross_tenant_scope_mismatch",
  "non_callable_tool_attempts",
] as const;

export type SecuritySignalType = (typeof SECURITY_SIGNAL_TYPES)[number];

/**
 * Codes de raison de signal — explicites, sans payload.
 * Alignés 1:1 sur les types de détecteurs.
 */
export const SECURITY_SIGNAL_REASON_CODES = [
  "REPEATED_PERMISSION_DENIALS",
  "REPEATED_APPROVAL_REPLAYS",
  "IDEMPOTENCY_CONFLICTS",
  "EXECUTOR_FAILURES",
  "AUDIT_PERSISTENCE_FAILURES",
  "APPROVAL_CONSUMED_WITHOUT_EXECUTION",
  "INDETERMINATE_EXECUTION_OUTCOMES",
  "INVALID_ARGUMENT_BURST",
  "CROSS_TENANT_SCOPE_MISMATCH",
  "NON_CALLABLE_TOOL_ATTEMPTS",
] as const;

export type SecuritySignalReasonCode =
  (typeof SECURITY_SIGNAL_REASON_CODES)[number];

/** Actions recommandées locales — pas d’envoi, pas de texte libre. */
export const ALERT_RECOMMENDED_ACTION_CODES = [
  "REVIEW_PERMISSION_DENIALS",
  "REVIEW_APPROVAL_REPLAYS",
  "REVIEW_IDEMPOTENCY_CONFLICTS",
  "REVIEW_EXECUTOR_FAILURES",
  "REVIEW_AUDIT_PERSISTENCE",
  "REVIEW_APPROVAL_CONSUMPTION",
  "REVIEW_INDETERMINATE_OUTCOMES",
  "REVIEW_INVALID_ARGUMENTS",
  "REVIEW_CROSS_TENANT_SCOPE",
  "REVIEW_NON_CALLABLE_TOOLS",
  "NO_ACTION",
] as const;

export type AlertRecommendedActionCode =
  (typeof ALERT_RECOMMENDED_ACTION_CODES)[number];

/** Noms de métriques déterministes (Task B — `metrics/**`). */
export const OBSERVABILITY_METRIC_NAMES = [
  "router_requests_total",
  "router_success_total",
  "router_blocked_total",
  "permission_denied_total",
  "approval_required_total",
  "approval_consumed_total",
  "approval_replay_total",
  "idempotency_conflict_total",
  "idempotency_replay_total",
  "executor_error_total",
  "audit_persistence_failure_total",
  "indeterminate_outcome_total",
  "route_duration_ms",
] as const;

export type ObservabilityMetricName =
  (typeof OBSERVABILITY_METRIC_NAMES)[number];
