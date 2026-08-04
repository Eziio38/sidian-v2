/**
 * Auth serveur Next.js / Supabase pour le point d’entrée Agent (G1-L).
 *
 * ## Flux
 *
 * ```
 * Request headers/cookies
 *   → ServerRequestAuthAdapter (AuthMaterial)
 *   → user-scoped Supabase (cookie SSR | Bearer anon)
 *   → createRequestGateway (principal + membership)
 *   → createToolRouter (persistance service_role documentée)
 *   → createAgentServerHandler
 * ```
 *
 * ## service_role
 *
 * Voir `service-role.ts`. Interdit pour auth/membership.
 * Autorisé uniquement pour audit / idempotency / approvals avec
 * `tenant_id` provenant du TrustedExecutionContext.
 */

export {
  createAgentHttpAuthAdapter,
} from "./create-auth-adapter";

export {
  createAgentHttpGateway,
} from "./create-gateway";
export type { CreateAgentHttpGatewayParams } from "./create-gateway";

export {
  buildAgentHttpToolRouter,
  getAgentHttpToolRouter,
  resetAgentHttpToolRouterCache,
} from "./create-router";

export {
  createAgentToolsRouteHandler,
} from "./create-route-handler";
export type { CreateAgentToolsRouteHandlerOptions } from "./create-route-handler";

export {
  createAgentPersistenceClient,
} from "./service-role";
export type { AgentPersistenceSupabaseClient } from "./service-role";

export {
  resolveUserScopedSupabaseClient,
} from "./user-scoped-client";
export type {
  ResolvedUserScopedClient,
  UserScopedClientKind,
} from "./user-scoped-client";
