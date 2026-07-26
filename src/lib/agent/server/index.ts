/**
 * Server Route Adapter (G1-L) — exports publics.
 *
 * Flux :
 * ```
 * Incoming HTTP Request
 *   → createAgentServerHandler
 *   → AuthMaterial (authAdapter serveur)
 *   → RequestGateway.resolve
 *   → TrustedExecutionContext
 *   → ToolRouter.route
 *   → Sanitized HTTP Response
 * ```
 *
 * Ce module n’expose **aucune** factory de TrustedExecutionContext,
 * ToolDefinition ni executor. La route `app/api/**` est hors périmètre.
 *
 * `server-only` : empêche l’import client-side du câblage HTTP agent.
 * Injection :
 * ```ts
 * const handler = createAgentServerHandler({
 *   gateway,
 *   router,
 *   authAdapter,
 *   requestIdFactory,
 *   clock,
 *   limits, // optionnel — défauts documentés dans limits.ts
 * });
 * ```
 */

import "server-only";

export {
  AGENT_SERVER_ERROR_CODES,
  AGENT_SERVER_SAFE_MESSAGES,
  AgentServerError,
  agentServerErrorDescriptor,
} from "./errors";
export type {
  AgentServerErrorCode,
  AgentServerErrorDescriptor,
  AgentServerHttpStatus,
} from "./errors";

export {
  DEFAULT_AGENT_SERVER_LIMITS,
  resolveAgentServerLimits,
} from "./limits";
export type {
  AgentServerLimits,
  AgentServerLimitsInput,
} from "./limits";

export {
  AGENT_SERVER_ALLOWED_METHODS,
  adaptAgentServerRequest,
  assertAllowedMethod,
  assertDeclaredBodyLength,
  assertJsonContentType,
  copyExternalToolRequest,
  parseExternalToolRequestBody,
  readBoundedRequestBody,
} from "./request-adapter";
export type {
  AgentServerAllowedMethod,
  ParsedAgentServerBody,
} from "./request-adapter";

export {
  buildErrorHttpResponse,
  buildMethodNotAllowedResponse,
  mapGatewayFailureToHttp,
  mapRouterResultToHttp,
  toWebResponse,
} from "./response-adapter";
export type {
  AgentServerHttpResponse,
  AgentServerResponseBody,
  BuildAgentServerResponseMeta,
} from "./response-adapter";

export { createAgentServerHandler } from "./route-handler";
export type {
  AgentServerAuthAdapter,
  AgentServerClock,
  AgentServerHandler,
  AgentServerRequestIdFactory,
  CreateAgentServerHandlerDeps,
} from "./route-handler";
