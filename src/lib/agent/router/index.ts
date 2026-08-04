/**
 * Tool Router déterministe (G1-D + trust boundary G1-K) — exports publics.
 */

export { ROUTER_ERROR_CODES, ROUTER_ERROR_CATEGORY } from "./error-codes";
export type { RouterErrorCode, RouterErrorCategory } from "./error-codes";

export {
  ToolExecutorError,
  isToolExecutorError,
  asTypedExecutorFailure,
} from "./executor";
export type {
  ToolExecutor,
  ToolExecutorInput,
  ResolveToolExecutor,
  ToolExecutorErrorCategory,
} from "./executor";

export {
  validatedToolIntentSchema,
  trustedRouteContextSchema,
  validatedToolResourceSchema,
  toolRouteRequestSchema,
  toolRouteContextSchema,
  toolRouteActorSchema,
  toolRouteTenantSchema,
  toolRouteToolRefSchema,
  toolRouteIntentionSchema,
} from "./request-schema";
export type {
  ParsedValidatedToolIntent,
  ParsedTrustedRouteContext,
  ParsedToolRouteRequest,
  ParsedToolRouteContext,
} from "./request-schema";

export {
  toolRouteResultSchema,
  toolRouteSuccessSchema,
  toolRouteBlockedSchema,
  toolRouteErrorSchema,
} from "./result-schema";

export { createToolRouter } from "./router";
export { deriveGrants } from "./derive-grants";
export type { DeriveGrantsInput, DeriveGrantsToolRef } from "./derive-grants";
export { routeFromGateway } from "./route-from-gateway";
export type { RouteFromGatewayResult } from "./route-from-gateway";

export {
  buildAuditDraft,
  buildPersistenceFailedResult,
  emitAuditOnResult,
  fingerprintOpaque,
  hashIdempotencyKey,
  mapBlockedToAuditOutcome,
} from "./audit-emit";

export {
  buildObservabilityRecordInput,
  emitObservabilityOnResult,
} from "./observability-emit";

export type {
  ToolRouter,
  ToolRouterDependencies,
  ToolRouterRegistry,
  ValidatedToolIntent,
  ToolRouteRequest,
  ToolRouteContext,
  TrustedExecutionContext,
  ToolRouteResult,
  ToolRouteSuccess,
  ToolRouteBlocked,
  ToolRouteError,
  ToolRouteErrorDetails,
  ToolRouteActor,
  ToolRouteTenant,
  ToolRouteToolRef,
  ToolRouteIntention,
  ToolRouteGrant,
  ToolRouteResource,
  ToolRouteResourceRef,
  ToolRouteHumanValidation,
  AgentMode,
  ActorType,
  AutonomyLevel,
  ResourceKind,
  HumanValidationStatus,
} from "./types";
