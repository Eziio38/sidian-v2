/**
 * Barrel fixtures G1-K — Request Gateway.
 */

export {
  expectNoJwtInContext,
  expectNoRawArgumentsLeak,
  expectNoSensitiveLeak,
  expectNoTokenInAuditPayload,
  expectNoUselessClaims,
} from "./assertions";

export {
  ACTOR_ID_A,
  ACTOR_ID_B,
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
  FIXED_NOW_WITHIN_TOKEN,
  FIXED_TOKEN_EXPIRED_AT,
  FIXED_TOKEN_EXPIRES_AT,
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
} from "./constants";

export {
  absentAuthMaterial,
  baseAuthMaterial,
  baseExternalRequest,
  baseGatewayRequest,
  baseRequestMetadata,
  externalWithForbiddenField,
} from "./inputs";

export {
  baseAuthenticatedPrincipal,
  createMemoryMembershipResolver,
  createMemoryPrincipalResolver,
  multiTenantMemberships,
} from "./memory-resolvers";
export type {
  MemoryMembership,
  MemoryMembershipResolver,
  MemoryPrincipalResolver,
} from "./memory-resolvers";

export { createGatewayTestHarness } from "./harness";
export type { GatewayTestHarness } from "./harness";
