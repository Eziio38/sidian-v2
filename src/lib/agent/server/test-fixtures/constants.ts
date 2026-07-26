/**
 * Constantes G1-L — Server Entry Point (fixtures).
 * Réutilise les UUID / tokens G1-K pour cohérence cross-gate.
 */

export {
  ACTOR_ID_A,
  APPROVAL_ID,
  BEARER_TOKEN_ACTOR_DISABLED,
  BEARER_TOKEN_AUDIENCE_MISMATCH,
  BEARER_TOKEN_EXPIRED,
  BEARER_TOKEN_INVALID,
  BEARER_TOKEN_ISSUER_MISMATCH,
  BEARER_TOKEN_VALID,
  CORRELATION_ID,
  FIXED_NOW,
  FIXED_NOW_AFTER_EXPIRY,
  FULL_ARGUMENTS_PAYLOAD,
  PRINCIPAL_SUBJECT_A,
  PRINCIPAL_SUBJECT_B,
  RAW_AUTH_PROVIDER_DETAIL,
  REQUEST_ID,
  SENSITIVE_RAW_JWT,
  SENSITIVE_RAW_TOKEN,
  SENSITIVE_STACK_FRAGMENT,
  SESSION_ID_HASH,
  TENANT_A_UUID,
  TENANT_B_UUID,
  TENANT_UNKNOWN_UUID,
} from "@/lib/agent/gateway/test-fixtures/constants";

/** Cookie session factice — ne doit jamais fuir dans la réponse HTTP. */
export const SENSITIVE_COOKIE_VALUE =
  "sb-127-auth-token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.g1l_SENSITIVE_COOKIE.sig";

/** Secret applicatif — ne doit jamais apparaître dans data/error. */
export const SENSITIVE_APP_SECRET = "sidian_g1l_app_secret_do_not_leak";

/** Fragment SQL brut — masqué dans les réponses. */
export const SENSITIVE_SQL_FRAGMENT =
  'SELECT * FROM agent_audit_events WHERE tenant_id = \'leak\'';

/** URL canonique fictive du handler (Request Web). */
export const AGENT_SERVER_TEST_URL =
  "http://127.0.0.1:3000/api/agent/tools";
