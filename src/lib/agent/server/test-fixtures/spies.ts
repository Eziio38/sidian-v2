/**
 * Spies Gateway / Router — ordre d’appel et latences injectées.
 */

import type {
  GatewayRequest,
  GatewayResolution,
  RequestGateway,
} from "@/lib/agent/gateway";
import type {
  ToolRouteResult,
  ToolRouter,
  TrustedExecutionContext,
  ValidatedToolIntent,
} from "@/lib/agent/router";

export type PipelinePhase = "gateway" | "router";

export type SpyGateway = RequestGateway & {
  resolveCalls: GatewayRequest[];
  callCount: () => number;
  reset: () => void;
};

export type SpyRouter = ToolRouter & {
  routeCalls: Array<{
    intent: ValidatedToolIntent | unknown;
    context: TrustedExecutionContext | unknown;
  }>;
  callCount: () => number;
  reset: () => void;
};

export type PipelineCallLog = {
  phases: PipelinePhase[];
  reset: () => void;
};

export function createPipelineCallLog(): PipelineCallLog {
  const phases: PipelinePhase[] = [];
  return {
    phases,
    reset() {
      phases.length = 0;
    },
  };
}

export type SpyGatewayOptions = {
  /** Délai artificiel avant resolve (ms). */
  delayMs?: number;
  /** Ne résout jamais — pour timeouts. */
  hang?: boolean;
  /** Remplace le résultat (sinon délègue à `inner`). */
  resolveResult?:
    | GatewayResolution
    | ((request: GatewayRequest) => Promise<GatewayResolution>);
  onCall?: (request: GatewayRequest) => void;
};

export function createSpyGateway(
  inner: RequestGateway,
  options: SpyGatewayOptions = {},
  pipeline?: PipelineCallLog,
): SpyGateway {
  const resolveCalls: GatewayRequest[] = [];

  return {
    resolveCalls,
    callCount: () => resolveCalls.length,
    reset() {
      resolveCalls.length = 0;
    },
    async resolve(request: GatewayRequest): Promise<GatewayResolution> {
      pipeline?.phases.push("gateway");
      resolveCalls.push(request);
      options.onCall?.(request);

      if (options.hang) {
        await new Promise<never>(() => {
          /* never settles */
        });
      }
      if (options.delayMs && options.delayMs > 0) {
        await new Promise((r) => setTimeout(r, options.delayMs));
      }
      if (options.resolveResult !== undefined) {
        return typeof options.resolveResult === "function"
          ? options.resolveResult(request)
          : options.resolveResult;
      }
      return inner.resolve(request);
    },
  };
}

export type SpyRouterOptions = {
  delayMs?: number;
  hang?: boolean;
  routeResult?:
    | ToolRouteResult
    | ((
        intent: ValidatedToolIntent | unknown,
        context: TrustedExecutionContext | unknown,
      ) => Promise<ToolRouteResult>);
  onCall?: (
    intent: ValidatedToolIntent | unknown,
    context: TrustedExecutionContext | unknown,
  ) => void;
  /** Avance l’horloge injectée au début de route() — timeout « avant Router ». */
  onBeforeRoute?: () => void;
};

export function createSpyRouter(
  inner: ToolRouter,
  options: SpyRouterOptions = {},
  pipeline?: PipelineCallLog,
): SpyRouter {
  const routeCalls: SpyRouter["routeCalls"] = [];

  return {
    routeCalls,
    callCount: () => routeCalls.length,
    reset() {
      routeCalls.length = 0;
    },
    async route(
      intent: ValidatedToolIntent | unknown,
      context: TrustedExecutionContext | unknown,
    ): Promise<ToolRouteResult> {
      options.onBeforeRoute?.();
      pipeline?.phases.push("router");
      routeCalls.push({ intent, context });
      options.onCall?.(intent, context);

      if (options.hang) {
        await new Promise<never>(() => {
          /* never settles */
        });
      }
      if (options.delayMs && options.delayMs > 0) {
        await new Promise((r) => setTimeout(r, options.delayMs));
      }
      if (options.routeResult !== undefined) {
        return typeof options.routeResult === "function"
          ? options.routeResult(intent, context)
          : options.routeResult;
      }
      return inner.route(intent, context);
    },
  };
}
