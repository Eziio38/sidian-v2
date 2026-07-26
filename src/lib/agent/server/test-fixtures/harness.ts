/**
 * Harness G1-L — createAgentServerHandler + gateway/router mémoire.
 * Zéro réseau (unitaires).
 */

import { createRequestGateway } from "@/lib/agent/gateway";
import { createServerRequestAuthAdapter } from "@/lib/agent/gateway/adapters";
import {
  createMemoryMembershipResolver,
  createMemoryPrincipalResolver,
  type MemoryMembershipResolver,
  type MemoryPrincipalResolver,
} from "@/lib/agent/gateway/test-fixtures";
import {
  createControlledIdempotencyService,
  createRouterTestHarness,
  createSpyObservabilityService,
  createWriteRouterTestHarness,
  type RouterTestHarness,
  type SpyIdempotencyService,
  type SpyObservabilityService,
} from "@/lib/agent/router/test-fixtures";
import {
  createAgentServerHandler,
  type AgentServerAuthAdapter,
  type AgentServerHandler,
  type AgentServerLimitsInput,
  type AgentServerRequestIdFactory,
} from "@/lib/agent/server";

import { createControllableClock, type ControllableClock } from "./clock";
import { REQUEST_ID } from "./constants";
import {
  createPipelineCallLog,
  createSpyGateway,
  createSpyRouter,
  type PipelineCallLog,
  type SpyGateway,
  type SpyGatewayOptions,
  type SpyRouter,
  type SpyRouterOptions,
} from "./spies";

export type AgentServerTestHarness = {
  handler: AgentServerHandler;
  gateway: SpyGateway;
  router: SpyRouter;
  authAdapter: AgentServerAuthAdapter;
  clock: ControllableClock;
  requestIdFactory: AgentServerRequestIdFactory;
  principalResolver: MemoryPrincipalResolver;
  membershipResolver: MemoryMembershipResolver;
  routerHarness: RouterTestHarness;
  pipeline: PipelineCallLog;
  idempotencyService: SpyIdempotencyService | null;
  observabilityService: SpyObservabilityService | null;
};

export type CreateAgentServerTestHarnessOptions = {
  limits?: AgentServerLimitsInput;
  gateway?: SpyGatewayOptions;
  router?: SpyRouterOptions;
  /** Mode permission router (défaut allow). */
  permissionMode?: "allow" | "deny" | "require_approval";
  /** Active idempotency spy / contrôlé. */
  withIdempotency?: boolean | SpyIdempotencyService;
  /** Active approval spy (défaut false ; writeTool force true). */
  withApproval?: boolean;
  /** Active observability (défaut true pour test 45). */
  withObservability?: boolean | SpyObservabilityService;
  /** Harness write (payment.create_attempt) au lieu de read. */
  writeTool?: boolean;
  /** Auth adapter injecté — défaut ServerRequestAuthAdapter réel. */
  authAdapter?: AgentServerAuthAdapter;
  /** Factory request_id — défaut REQUEST_ID fixe. */
  requestIdFactory?: AgentServerRequestIdFactory;
};

export function createAgentServerTestHarness(
  options: CreateAgentServerTestHarnessOptions = {},
): AgentServerTestHarness {
  const principalResolver = createMemoryPrincipalResolver();
  const membershipResolver = createMemoryMembershipResolver();
  const innerGateway = createRequestGateway({
    principalResolver,
    membershipResolver,
  });

  const pipeline = createPipelineCallLog();
  const gateway = createSpyGateway(innerGateway, options.gateway ?? {}, pipeline);

  const withApproval =
    options.withApproval ?? (options.writeTool ? true : false);

  const routerHarness = options.writeTool
    ? createWriteRouterTestHarness({
        permissionMode: options.permissionMode ?? "allow",
        withIdempotency: options.withIdempotency ?? false,
        withObservability: options.withObservability ?? true,
        withApproval,
        withAuditSink: true,
      })
    : createRouterTestHarness({
        permissionMode: options.permissionMode ?? "allow",
        withIdempotency: options.withIdempotency ?? false,
        withObservability: options.withObservability ?? true,
        withApproval,
        withAuditSink: true,
      });

  const router = createSpyRouter(
    routerHarness.router,
    options.router ?? {},
    pipeline,
  );

  const clock = createControllableClock();
  const requestIdFactory =
    options.requestIdFactory ?? (() => REQUEST_ID);
  const authAdapter =
    options.authAdapter ?? createServerRequestAuthAdapter();

  const handler = createAgentServerHandler({
    gateway,
    router,
    authAdapter,
    requestIdFactory,
    clock,
    limits: options.limits,
  });

  return {
    handler,
    gateway,
    router,
    authAdapter,
    clock,
    requestIdFactory,
    principalResolver,
    membershipResolver,
    routerHarness,
    pipeline,
    idempotencyService: routerHarness.idempotencyService,
    observabilityService: routerHarness.observabilityService,
  };
}

/** Variante avec idempotency contrôlée (conflict / in_progress). */
export function createAgentServerHarnessWithIdempotency(
  claim: Parameters<typeof createControlledIdempotencyService>[0]["claim"],
  options: Omit<CreateAgentServerTestHarnessOptions, "withIdempotency"> = {},
): AgentServerTestHarness {
  const controlled = createControlledIdempotencyService({ claim });
  return createAgentServerTestHarness({
    ...options,
    withIdempotency: controlled,
  });
}

/** Variante observability qui échoue (degraded, résultat principal intact). */
export function createAgentServerHarnessWithFailingObservability(
  options: Omit<CreateAgentServerTestHarnessOptions, "withObservability"> = {},
): AgentServerTestHarness {
  const obs = createSpyObservabilityService({
    sink: { throwOnRecord: true },
  });
  return createAgentServerTestHarness({
    ...options,
    withObservability: obs,
  });
}
