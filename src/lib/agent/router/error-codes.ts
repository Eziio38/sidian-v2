/**
 * Codes d’erreur stables du Tool Router (G1-D).
 * Jamais de stack, secrets ou payload sensible.
 */

export const ROUTER_ERROR_CODES = [
  "ROUTER_INPUT_INVALID",
  "TOOL_UNKNOWN",
  "TOOL_NOT_CALLABLE",
  "INPUT_SCHEMA_UNRESOLVED",
  "INVALID_ARGUMENT",
  "PERMISSION_DENIED",
  "APPROVAL_REQUIRED",
  "APPROVAL_NOT_FOUND",
  "APPROVAL_UNAVAILABLE",
  "APPROVAL_PENDING",
  "APPROVAL_REJECTED",
  "APPROVAL_EXPIRED",
  "APPROVAL_ALREADY_CONSUMED",
  "APPROVAL_SCOPE_MISMATCH",
  "APPROVAL_PARAMS_MISMATCH",
  "APPROVAL_AUTONOMY_MISMATCH",
  "APPROVAL_CONSUMPTION_FAILED",
  /** Échec de construction d’événement d’audit — fail-closed observabilité. */
  "AUDIT_BUILD_FAILED",
  /**
   * Consume atomique réussi mais exécuteur non démarré (échec interne avant execute).
   * L’approbation reste consumed — pas de réactivation.
   */
  "APPROVAL_CONSUMED_EXECUTION_NOT_STARTED",
  "EXECUTOR_UNAVAILABLE",
  "EXECUTOR_TECHNICAL_ERROR",
  "EXECUTOR_BUSINESS_ERROR",
  "OUTPUT_SCHEMA_UNRESOLVED",
  "INVALID_TOOL_OUTPUT",
  "AUDIT_PERSISTENCE_FAILED",
  "IDEMPOTENCY_KEY_CONFLICT",
  "IDEMPOTENCY_IN_PROGRESS",
  "IDEMPOTENCY_UNAVAILABLE",
  "IDEMPOTENCY_REPLAY_FAILURE",
  "IDEMPOTENCY_COMPLETION_FAILED",
  "ROUTER_INTERNAL_ERROR",
] as const;

export type RouterErrorCode = (typeof ROUTER_ERROR_CODES)[number];

export type RouterErrorCategory =
  | "technical"
  | "business"
  | "permission"
  | "validation";

/** Catégorie par défaut pour chaque code (fail-closed technique si doute). */
export const ROUTER_ERROR_CATEGORY: Record<
  RouterErrorCode,
  RouterErrorCategory
> = {
  ROUTER_INPUT_INVALID: "validation",
  TOOL_UNKNOWN: "technical",
  TOOL_NOT_CALLABLE: "technical",
  INPUT_SCHEMA_UNRESOLVED: "technical",
  INVALID_ARGUMENT: "business",
  PERMISSION_DENIED: "permission",
  APPROVAL_REQUIRED: "permission",
  APPROVAL_NOT_FOUND: "permission",
  APPROVAL_UNAVAILABLE: "technical",
  APPROVAL_PENDING: "permission",
  APPROVAL_REJECTED: "permission",
  APPROVAL_EXPIRED: "permission",
  APPROVAL_ALREADY_CONSUMED: "permission",
  APPROVAL_SCOPE_MISMATCH: "permission",
  APPROVAL_PARAMS_MISMATCH: "permission",
  APPROVAL_AUTONOMY_MISMATCH: "permission",
  APPROVAL_CONSUMPTION_FAILED: "technical",
  APPROVAL_CONSUMED_EXECUTION_NOT_STARTED: "technical",
  EXECUTOR_UNAVAILABLE: "technical",
  EXECUTOR_TECHNICAL_ERROR: "technical",
  EXECUTOR_BUSINESS_ERROR: "business",
  OUTPUT_SCHEMA_UNRESOLVED: "technical",
  INVALID_TOOL_OUTPUT: "technical",
  AUDIT_PERSISTENCE_FAILED: "technical",
  AUDIT_BUILD_FAILED: "technical",
  IDEMPOTENCY_KEY_CONFLICT: "technical",
  IDEMPOTENCY_IN_PROGRESS: "technical",
  IDEMPOTENCY_UNAVAILABLE: "technical",
  IDEMPOTENCY_REPLAY_FAILURE: "business",
  IDEMPOTENCY_COMPLETION_FAILED: "technical",
  ROUTER_INTERNAL_ERROR: "technical",
};
