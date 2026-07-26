/**
 * Constantes déterministes G1-D — aucune I/O, aucune horloge globale.
 */

export const FIXED_NOW = "2026-07-24T12:00:00.000Z";

/** @deprecated Non-UUID — poison / legacy only. Prefer TENANT_A_UUID. */
export const TENANT_A = "tenant_a";
/** @deprecated Non-UUID — poison / legacy only. Prefer TENANT_B_UUID. */
export const TENANT_B = "tenant_b";

export const ACTOR_ID = "actor_router_1";
export const CORRELATION_ID = "corr_router_1";
export const REQUEST_ID = "req_router_1";

export const INVOICE_1 = "inv_001";
export const INVOICE_2 = "inv_002";

export const PARAMS_HASH_V1 = "hash_params_router_v1";

/** Prestataire UUID pour chemins G1-G (claim exige tenant UUID). */
export const TENANT_A_UUID = "a1111111-1111-4111-8111-111111111111";
export const TENANT_B_UUID = "b2222222-2222-4222-8222-222222222222";

export const IDEMPOTENCY_KEY = "idem_router_g1g_001";
export const IDEMPOTENCY_KEY_ALT = "idem_router_g1g_002";

/** Approbation humaine déterministe (UUID) — G1-H. */
export const APPROVAL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const APPROVAL_ID_ALT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** Schémas absents du Schema Registry G1-B — pour INPUT/OUTPUT_SCHEMA_UNRESOLVED. */
export const MISSING_INPUT_SCHEMA_ID = "fixture.router.missing.input.v1";
export const MISSING_OUTPUT_SCHEMA_ID = "fixture.router.missing.output.v1";

/** Payload sensible simulé — ne doit jamais fuir dans un ToolRouteResult d’erreur. */
export const SENSITIVE_RAW_TOKEN = "sk_live_SENSITIVE_DO_NOT_LEAK";
export const SENSITIVE_RAW_FIELD = "raw_card_pan";
