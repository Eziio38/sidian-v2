/**
 * Constantes déterministes G1-I — aucune I/O, aucune horloge globale.
 */

export const FIXED_NOW = "2026-07-25T10:00:00.000Z";
export const FIXED_NOW_LATER = "2026-07-25T10:05:00.000Z";
export const WINDOW_START = "2026-07-25T09:00:00.000Z";
export const WINDOW_END = "2026-07-25T10:05:00.000Z";

export const TENANT_A = "tenant_obs_a";
export const TENANT_B = "tenant_obs_b";

export const CORRELATION_ID = "corr_obs_1";
export const EVENT_ID_EXPLICIT = "obs_explicit_fixed_id_001";

export const TOOL_ID = "invoice.get";
export const TOOL_VERSION = "1.0.0";

/** Secrets / payloads — ne doivent jamais apparaître dans un ObservabilityEvent. */
export const SENSITIVE_RAW_TOKEN = "sk_live_SENSITIVE_DO_NOT_LEAK";
export const SENSITIVE_RAW_FIELD = "raw_card_pan";
export const SENSITIVE_CARD_PAN = "4111111111111111";
export const SENSITIVE_STACK_FRAGMENT = "at Object.buildObservabilityEvent";
export const RAW_SQL_DETAIL =
  "duplicate key value violates unique constraint \"agent_audit_events_pkey\"";
export const FULL_ARGUMENTS_PAYLOAD = {
  api_key: SENSITIVE_RAW_TOKEN,
  card_pan: SENSITIVE_CARD_PAN,
  amount_cents: 4200,
};

/** Seuils de test explicites (override des défauts detectors). */
export const TEST_THRESHOLD_BURST = 3;
export const TEST_THRESHOLD_SINGLE = 1;
