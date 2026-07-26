/**
 * Server Route Adapter — handler HTTP → Gateway → Router (G1-L).
 *
 * Pipeline obligatoire :
 * method → Content-Type → size → JSON once → ExternalToolRequest
 * → authMaterial (adapter serveur) → Gateway → refuse si non authenticated
 * → Router(intent, TrustedExecutionContext) → HTTP sanitizé.
 *
 * Interdit :
 * - confiance tenant/actor body ;
 * - token dans JSON ;
 * - TrustedExecutionContext sérialisé ;
 * - ToolDefinition / executor ;
 * - Router avant Gateway ;
 * - fallback anonyme ;
 * - exception brute.
 */

import "server-only";

import {
  toTrustedRouteInput,
  type RequestGateway,
} from "@/lib/agent/gateway";
import type {
  ServerRequestAuthAdapterInput,
  ServerRequestAuthAdapterResult,
} from "@/lib/agent/gateway/adapters";
import type { ToolRouter } from "@/lib/agent/router";

import { AgentServerError } from "./errors";
import {
  resolveAgentServerLimits,
  type AgentServerLimits,
  type AgentServerLimitsInput,
} from "./limits";
import {
  adaptAgentServerRequest,
  assertAllowedMethod,
  copyExternalToolRequest,
} from "./request-adapter";
import {
  buildErrorHttpResponse,
  buildMethodNotAllowedResponse,
  mapGatewayFailureToHttp,
  mapRouterResultToHttp,
  toWebResponse,
  type AgentServerHttpResponse,
  type BuildAgentServerResponseMeta,
} from "./response-adapter";

/** Horloge injectée — jamais Date.now() implicite. */
export type AgentServerClock = {
  /** Instant ISO-8601 UTC. */
  now(): string;
};

/** Factory d’identifiants de requête injectée. */
export type AgentServerRequestIdFactory = () => string;

/**
 * Adapter auth serveur — extrait AuthMaterial depuis headers/cookies.
 * Typiquement `ServerRequestAuthAdapter` (G1-K) ; jamais depuis le body JSON.
 */
export type AgentServerAuthAdapter = {
  extract(
    input: ServerRequestAuthAdapterInput,
  ): ServerRequestAuthAdapterResult;
};

export type CreateAgentServerHandlerDeps = {
  gateway: RequestGateway;
  router: ToolRouter;
  authAdapter: AgentServerAuthAdapter;
  requestIdFactory: AgentServerRequestIdFactory;
  clock: AgentServerClock;
  /** Bornes injectées — fusionnées avec les défauts documentés si partielles. */
  limits?: AgentServerLimitsInput;
};

export type AgentServerHandler = (request: Request) => Promise<Response>;

type DeadlineState = {
  startedAtMs: number;
  limits: AgentServerLimits;
};

/**
 * Crée le handler HTTP canonique Agent (G1-L).
 * Ne contient aucune logique permission / approval / idempotence / executor.
 */
export function createAgentServerHandler(
  deps: CreateAgentServerHandlerDeps,
): AgentServerHandler {
  const limits = resolveAgentServerLimits(deps.limits);

  return async (request: Request): Promise<Response> => {
    const request_id = deps.requestIdFactory();
    let correlation_id = request_id;
    const meta = (): BuildAgentServerResponseMeta => ({
      request_id,
      correlation_id,
    });

    try {
      try {
        assertAllowedMethod(request.method);
      } catch (error) {
        if (
          error instanceof AgentServerError &&
          error.code === "HTTP_METHOD_NOT_ALLOWED"
        ) {
          return toWebResponse(buildMethodNotAllowedResponse(meta()));
        }
        throw error;
      }

      const startedAtMs = parseInstantMs(deps.clock.now());
      const deadline: DeadlineState = { startedAtMs, limits };

      const adapted = await adaptAgentServerRequest(request, limits);
      const externalRequest = copyExternalToolRequest(adapted.externalRequest);

      if (externalRequest.correlation_id) {
        correlation_id = externalRequest.correlation_id;
      }

      const authExtracted = deps.authAdapter.extract({
        headers: request.headers,
        request_id,
        correlation_id,
      });

      if (authExtracted.requestMetadata.correlation_id) {
        correlation_id = authExtracted.requestMetadata.correlation_id;
      }

      // Budget total — refuse de démarrer la Gateway si déjà dépassé.
      assertBudgetAllows(deadline, deps.clock, "gateway");

      const now = deps.clock.now();
      const gatewayTimeoutMs = remainingBudgetMs(
        deadline,
        deps.clock,
        limits.gateway_timeout_ms,
      );

      const resolution = await raceWithTimeout(
        deps.gateway.resolve({
          externalRequest,
          authMaterial: authExtracted.authMaterial,
          requestMetadata: {
            request_id,
            correlation_id,
            ...(authExtracted.requestMetadata.requested_tenant_id !== undefined
              ? {
                  requested_tenant_id:
                    authExtracted.requestMetadata.requested_tenant_id,
                }
              : {}),
          },
          now,
        }),
        gatewayTimeoutMs,
        request.signal,
      );

      if (resolution.status !== "authenticated") {
        const failureMeta: BuildAgentServerResponseMeta = {
          request_id:
            resolution.request_id?.trim() || request_id,
          correlation_id:
            resolution.correlation_id?.trim() || correlation_id,
        };
        return toWebResponse(mapGatewayFailureToHttp(failureMeta, resolution));
      }

      correlation_id = resolution.context.correlation_id;
      const trustedMeta: BuildAgentServerResponseMeta = {
        request_id: resolution.context.request_id,
        correlation_id,
      };

      // Budget total — refuse de démarrer le Router si déjà dépassé.
      assertBudgetAllows(deadline, deps.clock, "router");

      const { request: intent, context } = toTrustedRouteInput(resolution);
      const routerTimeoutMs = remainingBudgetMs(
        deadline,
        deps.clock,
        limits.router_timeout_ms,
      );

      const routeResult = await raceWithTimeout(
        deps.router.route(intent, context),
        routerTimeoutMs,
        request.signal,
      );

      return toWebResponse(mapRouterResultToHttp(trustedMeta, routeResult));
    } catch (error) {
      return toWebResponse(mapCaughtErrorToHttp(meta(), error));
    }
  };
}

function mapCaughtErrorToHttp(
  meta: BuildAgentServerResponseMeta,
  error: unknown,
): AgentServerHttpResponse {
  if (error instanceof AgentServerError) {
    return buildErrorHttpResponse(meta, error.code, error.httpStatus);
  }
  if (isAbortError(error)) {
    return buildErrorHttpResponse(meta, "HTTP_REQUEST_TIMEOUT", 408);
  }
  // Jamais d’exception brute — masquage systématique.
  return buildErrorHttpResponse(meta, "INTERNAL_SERVER_ERROR", 500);
}

function assertBudgetAllows(
  deadline: DeadlineState,
  clock: AgentServerClock,
  stage: "gateway" | "router",
): void {
  const elapsed = elapsedMs(deadline, clock);
  if (elapsed >= deadline.limits.total_timeout_ms) {
    throw new AgentServerError("HTTP_REQUEST_TIMEOUT", 408);
  }
  // Garde-fou : s’il ne reste pas assez pour démarrer l’étape (budget 0).
  if (stage === "gateway" && remainingTotalMs(deadline, clock) <= 0) {
    throw new AgentServerError("HTTP_REQUEST_TIMEOUT", 408);
  }
  if (stage === "router" && remainingTotalMs(deadline, clock) <= 0) {
    throw new AgentServerError("HTTP_REQUEST_TIMEOUT", 408);
  }
}

function remainingBudgetMs(
  deadline: DeadlineState,
  clock: AgentServerClock,
  stageCapMs: number,
): number {
  const remainingTotal = remainingTotalMs(deadline, clock);
  return Math.max(1, Math.min(stageCapMs, remainingTotal));
}

function remainingTotalMs(
  deadline: DeadlineState,
  clock: AgentServerClock,
): number {
  return Math.max(0, deadline.limits.total_timeout_ms - elapsedMs(deadline, clock));
}

function elapsedMs(deadline: DeadlineState, clock: AgentServerClock): number {
  return Math.max(0, parseInstantMs(clock.now()) - deadline.startedAtMs);
}

function parseInstantMs(iso: string): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    throw new AgentServerError("INTERNAL_SERVER_ERROR", 500);
  }
  return ms;
}

/**
 * Race avec timeout / AbortSignal.
 * Ne prétend pas annuler un effet externe déjà déclenché — seule la
 * promesse d’attente est abandonnée côté handler.
 */
function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal | null,
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(new AgentServerError("HTTP_REQUEST_TIMEOUT", 408));
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new AgentServerError("HTTP_REQUEST_TIMEOUT", 408));
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new AgentServerError("HTTP_REQUEST_TIMEOUT", 408));
    }, timeoutMs);

    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (err: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      },
    );
  });
}

function isAbortError(error: unknown): boolean {
  if (error instanceof AgentServerError && error.code === "HTTP_REQUEST_TIMEOUT") {
    return true;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }
  return false;
}
