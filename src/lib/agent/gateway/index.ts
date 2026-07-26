/**
 * Request Gateway / trust boundary (G1-K) — exports publics.
 *
 * Flux :
 * ```
 * ExternalToolRequest (non fiable)
 *   + AuthMaterial (adapter serveur)
 *   → RequestGateway.resolve
 *   → TrustedExecutionContext (vérifié)
 *   → Tool Router
 * ```
 *
 * Les adapters concrets Supabase vivent dans `adapters/` (tâche C).
 * Ce module n’expose que les **interfaces** de resolvers.
 *
 * Injection :
 * ```ts
 * const gateway = createRequestGateway({
 *   principalResolver,   // AuthPrincipalResolver
 *   membershipResolver,  // TenantMembershipResolver
 * });
 * const resolution = await gateway.resolve({
 *   externalRequest,
 *   authMaterial,        // jamais depuis le body
 *   requestMetadata,
 *   now,                 // horloge injectée
 * });
 * ```
 */

export {
  GATEWAY_ERROR_CODES,
  GATEWAY_ERROR_CATEGORIES,
  GATEWAY_SAFE_MESSAGES,
  GATEWAY_ERROR_CATEGORY_BY_CODE,
  GATEWAY_DECISIONS,
  GATEWAY_ERROR_CODE_BY_DECISION,
  GatewayError,
  gatewayErrorDescriptor,
  gatewayErrorFromDecision,
} from "./errors";
export type {
  GatewayErrorCode,
  GatewayErrorCategory,
  GatewayDecision,
  GatewayDenialDecision,
  GatewayErrorDescriptor,
} from "./errors";

export {
  AUTHENTICATION_METHODS,
  TRUST_LEVELS,
  TRUSTED_ROLE_ALLOWLIST,
  EXTERNAL_REQUEST_FORBIDDEN_FIELDS,
} from "./types";
export type {
  AuthenticationMethod,
  TrustLevel,
  TrustedRole,
  ExternalRequestForbiddenField,
  ExternalToolResource,
  ExternalToolRequest,
  AuthMaterial,
  GatewayRequestMetadata,
  GatewayRequest,
  AuthenticatedPrincipal,
  TrustedExecutionContext,
  GatewayResolutionAuthenticated,
  GatewayResolutionDenied,
  GatewayResolutionInvalid,
  GatewayResolution,
  GatewayResult,
  RequestGateway,
  ResolvePrincipalInput,
  ResolvePrincipalResult,
  AuthPrincipalResolver,
  ResolveMembershipInput,
  ResolveMembershipResult,
  TenantMembershipResolver,
  RequestGatewayDependencies,
  ActorType,
  AgentMode,
  AutonomyLevel,
  ResourceKind,
} from "./types";

export {
  externalToolResourceSchema,
  externalToolRequestSchema,
  authMaterialSchema,
  gatewayRequestMetadataSchema,
  gatewayRequestSchema,
  authenticationMethodSchema,
  trustedRoleSchema,
  trustLevelSchema,
  authenticatedPrincipalSchema,
  trustedExecutionContextSchema,
} from "./schemas";
export type {
  ParsedExternalToolRequest,
  ParsedAuthMaterial,
  ParsedGatewayRequestMetadata,
  ParsedGatewayRequest,
  ParsedAuthenticatedPrincipal,
  ParsedTrustedExecutionContext,
} from "./schemas";

export {
  sanitizeAuthenticatedPrincipal,
  isPrincipalExpired,
} from "./principal";

export {
  sanitizeTrustedRoles,
  buildTrustedExecutionContext,
} from "./trusted-context";
export type { BuildTrustedExecutionContextInput } from "./trusted-context";

export { createRequestGateway } from "./gateway";

export { toTrustedRouteInput } from "./to-trusted-route-input";
export type {
  ValidatedToolIntent,
  TrustedRouteInput,
} from "./to-trusted-route-input";
