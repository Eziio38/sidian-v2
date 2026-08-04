/**
 * Constantes G1-G — fixtures mémoire (fingerprint + service).
 * tenant_id = UUID prestataire (aligné migration agent_idempotency_records).
 */

export const FIXED_NOW = "2026-07-24T12:00:00.000Z";
/** Instant après expiration d’un lease de 120 s démarré à FIXED_NOW. */
export const FIXED_NOW_AFTER_EXPIRY = "2026-07-24T12:03:00.000Z";
/** Instant encore dans le lease (60 s après FIXED_NOW, TTL 120). */
export const FIXED_NOW_WITHIN_LEASE = "2026-07-24T12:01:00.000Z";

/** Prestataire A — UUID déterministe (hors DB réelle en unitaires). */
export const TENANT_A_UUID = "a1111111-1111-4111-8111-111111111111";
/** Prestataire B — cross-tenant. */
export const TENANT_B_UUID = "b2222222-2222-4222-8222-222222222222";

export const CORRELATION_ID = "corr_g1g_1";
export const IDEMPOTENCY_KEY = "idem_g1g_001";
export const INVOICE_1 = "inv_g1g_001";
export const INVOICE_2 = "inv_g1g_002";
export const OUTPUT_HASH = "hash_output_g1g_v1";
export const PARAMS_HASH = "hash_params_g1g_v1";
export const FINGERPRINT_A =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const FINGERPRINT_B =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

export const TTL_SECONDS = 120;

/** Fragments sensibles — ne doivent jamais apparaître dans décisions / erreurs. */
export const SENSITIVE_RAW_TOKEN = "sk_live_G1G_SENSITIVE_DO_NOT_LEAK";
export const SENSITIVE_CARD_PAN = "4111111111111111";
export const SENSITIVE_STACK_FRAGMENT = "at Object.claimIdempotency";
export const RAW_SQL_DETAIL =
  'duplicate key value violates unique constraint "agent_idempotency_records_tenant_key_uq" DETAIL: Key (tenant_id, idempotency_key)=(a1111111-1111-4111-8111-111111111111, idem_g1g_001) already exists.';

export const OWNER_TOKEN_A =
  "g1g_owner_token_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const OWNER_TOKEN_B =
  "g1g_owner_token_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
