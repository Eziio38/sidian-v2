/**
 * Constantes G1-F — persistance audit (fixtures mémoire + mocks).
 * tenant_id = UUID prestataire (contrainte FK migration agent_audit_events).
 */

export const FIXED_NOW = "2026-07-24T12:00:00.000Z";

/** Prestataire A — UUID déterministe (hors DB réelle en unitaires). */
export const TENANT_A_UUID = "a1111111-1111-4111-8111-111111111111";
/** Prestataire B — cross-tenant. */
export const TENANT_B_UUID = "b2222222-2222-4222-8222-222222222222";

export const ACTOR_ID = "actor_g1f_1";
export const CORRELATION_ID = "corr_g1f_1";
export const INVOICE_1 = "inv_g1f_001";
export const PARAMS_HASH = "hash_params_g1f_v1";
export const OUTPUT_HASH = "hash_output_g1f_v1";
export const EXECUTOR_ID = "executor_g1f_invoice_get";
export const HUMAN_VALIDATION_ID = "val_g1f_001";
export const IDEMPOTENCY_KEY = "idem_g1f_001";

/** Fragments sensibles — ne doivent jamais apparaître dans insert / erreurs. */
export const SENSITIVE_RAW_TOKEN = "sk_live_G1F_SENSITIVE_DO_NOT_LEAK";
export const SENSITIVE_CARD_PAN = "4111111111111111";
export const SENSITIVE_STACK_FRAGMENT = "at Object.appendAuditEvent";
export const RAW_SQL_DETAIL =
  'duplicate key value violates unique constraint "agent_audit_events_pkey" DETAIL: Key (audit_id)=(aud_deadbeef) already exists.';
