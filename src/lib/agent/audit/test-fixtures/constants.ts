/**
 * Constantes déterministes G1-E — aucune I/O, aucune horloge globale.
 */

export const FIXED_NOW = "2026-07-24T12:00:00.000Z";
export const FIXED_NOW_LATER = "2026-07-24T13:00:00.000Z";

export const TENANT_A = "tenant_a";
export const TENANT_B = "tenant_b";

export const ACTOR_ID = "actor_audit_1";
export const CORRELATION_ID = "corr_audit_1";

export const INVOICE_1 = "inv_001";

export const PARAMS_HASH_V1 = "hash_params_audit_v1";
export const PARAMS_HASH_V2 = "hash_params_audit_v2";
export const OUTPUT_HASH_V1 = "hash_output_audit_v1";
export const OUTPUT_HASH_V2 = "hash_output_audit_v2";

export const EXECUTOR_ID = "executor_memory_invoice_get";
export const HUMAN_VALIDATION_ID = "val_audit_001";
export const IDEMPOTENCY_KEY = "idem_audit_001";

/** Secrets / payloads sensibles — ne doivent jamais apparaître dans un AuditEvent. */
export const SENSITIVE_RAW_TOKEN = "sk_live_SENSITIVE_DO_NOT_LEAK";
export const SENSITIVE_RAW_FIELD = "raw_card_pan";
export const SENSITIVE_CARD_PAN = "4111111111111111";
export const SENSITIVE_STACK_FRAGMENT = "at Object.buildAuditEvent";
