/**
 * Composition HTTP : AuthMaterial réel + Gateway user-scopée + Router
 * service_role → `createAgentServerHandler` (G1-L).
 *
 * TrustedExecutionContext : uniquement via Gateway — jamais depuis le body.
 */

import "server-only";

import {
  createAgentServerHandler,
  type AgentServerHandler,
  type AgentServerLimitsInput,
} from "@/lib/agent/server";
import {
  createRequestId,
  requestIdFromHeaders,
} from "@/lib/observability/request-id";

import { createAgentHttpAuthAdapter } from "./create-auth-adapter";
import { createAgentHttpGateway } from "./create-gateway";
import { getAgentHttpToolRouter } from "./create-router";
import { resolveUserScopedSupabaseClient } from "./user-scoped-client";

export type CreateAgentToolsRouteHandlerOptions = {
  limits?: AgentServerLimitsInput;
};

/**
 * Construit un handler POST outillé pour une requête HTTP donnée.
 *
 * Gateway (resolvers) = client user de **cette** requête.
 * Router (audit/idempotency/approvals) = client service_role partagé (cache).
 */
export async function createAgentToolsRouteHandler(
  request: Request,
  options?: CreateAgentToolsRouteHandlerOptions,
): Promise<AgentServerHandler> {
  const authAdapter = createAgentHttpAuthAdapter();

  // Pré-extraction pour câbler le client user avant Gateway.resolve.
  // Le handler rappellera extract() — même source headers, résultat cohérent.
  const preview = authAdapter.extract({
    headers: request.headers,
  });
  const userScoped = await resolveUserScopedSupabaseClient(
    preview.authMaterial,
  );

  const gateway = createAgentHttpGateway({
    supabase: userScoped.supabase,
    supabaseUrl: userScoped.supabaseUrl,
  });
  const router = await getAgentHttpToolRouter();

  return createAgentServerHandler({
    gateway,
    router,
    authAdapter,
    requestIdFactory: () => resolveRequestId(request),
    clock: {
      now: () => new Date().toISOString(),
    },
    ...(options?.limits !== undefined ? { limits: options.limits } : {}),
  });
}

/**
 * Préfère l’id edge (`x-sidian-request-id`) puis `x-request-id` — sinon UUID v4.
 */
function resolveRequestId(request: Request): string {
  const fromSidian = requestIdFromHeaders(request.headers);
  if (fromSidian) {
    return fromSidian;
  }
  const legacy = request.headers.get("x-request-id")?.trim();
  if (legacy && legacy.length > 0) {
    return legacy;
  }
  return createRequestId();
}
