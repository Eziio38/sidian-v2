/**
 * Constantes G1-K — fixtures mémoire (gateway + resolvers).
 * tenant_id = UUID prestataire (aligné modèle EPICU / RLS).
 */

export const FIXED_NOW = "2026-07-25T10:00:00.000Z";
/** Instant après expiration d’un jeton (expires_at = FIXED_TOKEN_EXPIRES_AT). */
export const FIXED_NOW_AFTER_EXPIRY = "2026-07-25T12:00:01.000Z";
/** Instant encore dans la fenêtre du jeton. */
export const FIXED_NOW_WITHIN_TOKEN = "2026-07-25T11:00:00.000Z";

/** Expiration jeton valide (2 h après FIXED_NOW). */
export const FIXED_TOKEN_EXPIRES_AT = "2026-07-25T12:00:00.000Z";
/** Expiration déjà dépassée à FIXED_NOW. */
export const FIXED_TOKEN_EXPIRED_AT = "2026-07-25T09:59:59.000Z";

/** Prestataire A — UUID déterministe (hors DB réelle en unitaires). */
export const TENANT_A_UUID = "a1111111-1111-4111-8111-111111111111";
/** Prestataire B — cross-tenant / multi-tenant. */
export const TENANT_B_UUID = "b2222222-2222-4222-8222-222222222222";
/** Tenant inconnu (jamais membre). */
export const TENANT_UNKNOWN_UUID = "c3333333-3333-4333-8333-333333333333";

export const REQUEST_ID = "req_g1k_1";
export const CORRELATION_ID = "corr_g1k_1";
export const APPROVAL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

export const PRINCIPAL_SUBJECT_A = "user_g1k_subject_a";
export const ACTOR_ID_A = "actor_g1k_a";
export const PRINCIPAL_SUBJECT_B = "user_g1k_subject_b";
export const ACTOR_ID_B = "actor_g1k_b";

export const SESSION_ID_HASH =
  "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

export const BEARER_TOKEN_VALID = "g1k.valid.bearer.token.opaque";
export const BEARER_TOKEN_INVALID = "g1k.invalid.bearer.token";
export const BEARER_TOKEN_EXPIRED = "g1k.expired.bearer.token";
export const BEARER_TOKEN_ISSUER_MISMATCH = "g1k.issuer.mismatch.token";
export const BEARER_TOKEN_AUDIENCE_MISMATCH = "g1k.audience.mismatch.token";
export const BEARER_TOKEN_ACTOR_DISABLED = "g1k.actor.disabled.token";

/** Fragments sensibles — ne doivent jamais apparaître dans contexte / erreurs. */
export const SENSITIVE_RAW_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.g1k_SENSITIVE_JWT_PAYLOAD.signature";
export const SENSITIVE_RAW_TOKEN = "sk_live_G1K_SENSITIVE_DO_NOT_LEAK";
export const SENSITIVE_STACK_FRAGMENT = "at Object.resolvePrincipal";
export const RAW_AUTH_PROVIDER_DETAIL =
  'AuthApiError: Invalid JWT: unable to parse or verify signature DETAIL: kid=g1k_leak';
export const FULL_ARGUMENTS_PAYLOAD = {
  amount_cents: 42_00,
  client_iban: "FR761234567890",
  secret: SENSITIVE_RAW_TOKEN,
};
