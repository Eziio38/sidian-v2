/**
 * Orchestrateur optionnel : GatewayResolution → Tool Router (G1-K).
 * Refuse silencieusement de router si la résolution n’est pas authentifiée.
 */

import type {
  GatewayResolution,
  GatewayResolutionDenied,
  GatewayResolutionInvalid,
} from "@/lib/agent/gateway/types";
import { toTrustedRouteInput } from "@/lib/agent/gateway/to-trusted-route-input";

import { createToolRouter } from "./router";
import type {
  ToolRouteResult,
  ToolRouterDependencies,
} from "./types";

export type RouteFromGatewayResult =
  | { status: "routed"; result: ToolRouteResult }
  | {
      status: "gateway_denied";
      resolution: GatewayResolutionDenied;
    }
  | {
      status: "gateway_invalid";
      resolution: GatewayResolutionInvalid;
    };

/**
 * Si `resolution.status === "authenticated"` : assemble l’entrée de confiance
 * via `toTrustedRouteInput` puis appelle `createToolRouter(deps).route(...)`.
 * Sinon : propage le refus / invalid sans appeler le Router.
 */
export async function routeFromGateway(
  resolution: GatewayResolution,
  deps: ToolRouterDependencies,
): Promise<RouteFromGatewayResult> {
  if (resolution.status === "denied") {
    return { status: "gateway_denied", resolution };
  }
  if (resolution.status === "invalid") {
    return { status: "gateway_invalid", resolution };
  }

  const { request, context } = toTrustedRouteInput(resolution);
  const router = createToolRouter(deps);
  const result = await router.route(request, context);
  return { status: "routed", result };
}
