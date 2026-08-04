/**
 * Constantes G1-H — fixtures mémoire (service + mocks).
 * tenant_id = UUID prestataire (aligné migration agent_human_approvals).
 */

export const FIXED_NOW = "2026-07-24T12:00:00.000Z";
/** Instant encore dans la fenêtre d’expiration (TTL 3600). */
export const FIXED_NOW_WITHIN_TTL = "2026-07-24T12:30:00.000Z";
/** Instant après expiration d’un TTL de 3600 s démarré à FIXED_NOW. */
export const FIXED_NOW_AFTER_EXPIRY = "2026-07-24T13:01:00.000Z";

/** Expiration absolue valide (1 h après FIXED_NOW). */
export const FIXED_EXPIRES_AT = "2026-07-24T13:00:00.000Z";
/** Expiration invalide (≤ now). */
export const FIXED_EXPIRES_AT_INVALID = "2026-07-24T11:59:59.000Z";

/** Prestataire A — UUID déterministe (hors DB réelle en unitaires). */
export const TENANT_A_UUID = "a1111111-1111-4111-8111-111111111111";
/** Prestataire B — cross-tenant. */
export const TENANT_B_UUID = "b2222222-2222-4222-8222-222222222222";

export const APPROVAL_ID_UNKNOWN =
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

export const CORRELATION_ID = "corr_g1h_1";
export const INVOICE_1 = "inv_g1h_001";
export const INVOICE_2 = "inv_g1h_002";
export const PARAMS_HASH =
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
export const PARAMS_HASH_B =
  "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
export const FINGERPRINT_A =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const FINGERPRINT_B =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const IDEMPOTENCY_KEY_HASH =
  "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

export const TTL_SECONDS = 3600;

export const REQUESTER_ACTOR_ID = "actor_requester_g1h";
export const DECIDER_ACTOR_ID = "actor_decider_g1h";
export const REASON_CODE_APPROVE = "human_approved_sensitive_action";
export const REASON_CODE_REJECT = "human_rejected_sensitive_action";

/** Fragments sensibles — ne doivent jamais apparaître dans décisions / erreurs. */
export const SENSITIVE_RAW_TOKEN = "sk_live_G1H_SENSITIVE_DO_NOT_LEAK";
export const SENSITIVE_CARD_PAN = "4111111111111111";
export const SENSITIVE_STACK_FRAGMENT = "at Object.consumeHumanApproval";
export const RAW_SQL_DETAIL =
  'duplicate key value violates unique constraint "agent_human_approvals_pkey" DETAIL: Key (approval_id)=(cccccccc-cccc-4ccc-8ccc-cccccccccccc) already exists.';
export const FULL_ARGUMENTS_PAYLOAD = {
  amount_cents: 42_00,
  client_iban: "FR761234567890",
  secret: SENSITIVE_RAW_TOKEN,
};
