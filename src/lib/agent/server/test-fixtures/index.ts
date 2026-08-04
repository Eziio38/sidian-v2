/**
 * Barrel fixtures G1-L — Server Entry Point.
 */

export {
  expectErrorResponse,
  expectHttpBodyShape,
  expectNoSensitiveHttpLeak,
  expectSuccessResponse,
  readJsonBody,
} from "./assertions";

export {
  createControllableClock,
} from "./clock";
export type { ControllableClock } from "./clock";

export {
  ACTOR_ID_A,
  AGENT_SERVER_TEST_URL,
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
  SENSITIVE_APP_SECRET,
  SENSITIVE_COOKIE_VALUE,
  SENSITIVE_RAW_JWT,
  SENSITIVE_RAW_TOKEN,
  SENSITIVE_SQL_FRAGMENT,
  SENSITIVE_STACK_FRAGMENT,
  SESSION_ID_HASH,
  TENANT_A_UUID,
  TENANT_B_UUID,
  TENANT_UNKNOWN_UUID,
} from "./constants";

export {
  createAgentHttpRequest,
  nominalExternalBody,
  poisonedExternalBody,
} from "./http-request";
export type { AgentHttpRequestOptions } from "./http-request";

export {
  createAgentServerHarnessWithFailingObservability,
  createAgentServerHarnessWithIdempotency,
  createAgentServerTestHarness,
} from "./harness";
export type {
  AgentServerTestHarness,
  CreateAgentServerTestHarnessOptions,
} from "./harness";

export {
  createPipelineCallLog,
  createSpyGateway,
  createSpyRouter,
} from "./spies";
export type {
  PipelineCallLog,
  PipelinePhase,
  SpyGateway,
  SpyGatewayOptions,
  SpyRouter,
  SpyRouterOptions,
} from "./spies";

export {
  createAgentServerHandler,
  createBearerScopedSupabaseClient,
  createRequestGateway,
  createServerRequestAuthAdapter,
  createSupabaseAuthPrincipalResolver,
  createSupabaseTenantMembershipResolver,
} from "./integration-adapters";
