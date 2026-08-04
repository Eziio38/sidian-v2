/**
 * Harness de câblage mémoire pour createToolRouter (tests uniquement).
 */

import { createToolRouter } from "@/lib/agent/router";

import {
  createSpyApprovalService,
  type SpyApprovalService,
} from "./approval-service";
import {
  createSpyAuditService,
  type SpyAuditService,
} from "./audit-service";
import {
  createSpyAuditSink,
  type SpyAuditSink,
  type SpyAuditSinkOptions,
} from "./audit-sink";
import { createCallLog, type CallLog } from "./call-log";
import { memoryDefinitions } from "./definitions";
import {
  createFixedResultExecutor,
  createMemoryExecutorResolver,
  createSpyExecutor,
  validInvoiceGetOutput,
  validPaymentCreateAttemptOutput,
  type MemoryExecutorResolver,
  type SpyToolExecutor,
} from "./executors";
import {
  createControlledIdempotencyService,
  createSpyIdempotencyService,
  type SpyIdempotencyService,
} from "./idempotency-service";
import {
  createSpyObservabilityService,
  type SpyObservabilityService,
  type SpyObservabilityServiceOptions,
} from "./observability-service";
import {
  createFakePermissionService,
  type FakePermissionService,
} from "./permission-service";
import {
  createMemoryToolRegistry,
  type MemoryToolRegistry,
} from "./registry";

export type RouterTestHarness = {
  router: ReturnType<typeof createToolRouter>;
  registry: MemoryToolRegistry;
  permissionService: FakePermissionService;
  executorResolver: MemoryExecutorResolver;
  executor: SpyToolExecutor;
  auditService: SpyAuditService;
  /** Présent sauf si `withAuditSink: false`. */
  auditSink: SpyAuditSink | null;
  /** Présent sauf si `withIdempotency` omis/false. */
  idempotencyService: SpyIdempotencyService | null;
  /** Présent sauf si `withApproval` omis/false. */
  approvalService: SpyApprovalService | null;
  /** Présent sauf si `withObservability` omis/false. */
  observabilityService: SpyObservabilityService | null;
  callLog: CallLog;
};

export function createRouterTestHarness(
  options: {
    definitions?: typeof memoryDefinitions;
    permissionMode?: "allow" | "deny" | "require_approval";
    /** Si false, aucun exécuteur enregistré (EXECUTOR_UNAVAILABLE). */
    withExecutor?: boolean;
    executorResult?: unknown;
    executorError?: unknown | (() => unknown);
    toolId?: string;
    toolVersion?: string;
    /**
     * Sink G1-F. Défaut : spy succès.
     * `false` → pas de sink (comportement G1-E mémoire seule).
     */
    withAuditSink?: boolean | SpyAuditSinkOptions;
    /**
     * Idempotency G1-G. Défaut : `false` (compat G1-D/E/F sans clé).
     * `true` → spy mémoire ; objet → service contrôlé.
     */
    withIdempotency?: boolean | SpyIdempotencyService;
    /**
     * Approval G1-H. Défaut : `false`.
     * `true` → spy approved+consume ; objet → service contrôlé.
     */
    withApproval?: boolean | SpyApprovalService;
    /**
     * Observability G1-I. Défaut : `false` (compat G1-D…H sans obs).
     * `true` → service+sink spy succès ; objet → options / service.
     */
    withObservability?: boolean | SpyObservabilityService | SpyObservabilityServiceOptions;
  } = {},
): RouterTestHarness {
  const callLog = createCallLog();
  const definitions = options.definitions ?? memoryDefinitions;
  const registry = createMemoryToolRegistry(definitions);
  const permissionService = createFakePermissionService({
    mode: options.permissionMode ?? "allow",
    callLog,
  });
  const auditService = createSpyAuditService();
  const auditSink =
    options.withAuditSink === false
      ? null
      : createSpyAuditSink(
          typeof options.withAuditSink === "object"
            ? options.withAuditSink
            : {},
        );

  const idempotencyService =
    options.withIdempotency === false || options.withIdempotency === undefined
      ? null
      : options.withIdempotency === true
        ? createSpyIdempotencyService()
        : options.withIdempotency;

  const approvalService =
    options.withApproval === false || options.withApproval === undefined
      ? null
      : options.withApproval === true
        ? createSpyApprovalService()
        : options.withApproval;

  const observabilityService =
    options.withObservability === false ||
    options.withObservability === undefined
      ? null
      : options.withObservability === true
        ? createSpyObservabilityService()
        : typeof options.withObservability === "object" &&
            "record" in options.withObservability
          ? (options.withObservability as SpyObservabilityService)
          : createSpyObservabilityService(
              options.withObservability as SpyObservabilityServiceOptions,
            );

  const toolId = options.toolId ?? "invoice.get";
  const toolVersion = options.toolVersion ?? "1.0.0";

  const executor = createSpyExecutor({
    result: options.executorResult ?? validInvoiceGetOutput(),
    error: options.executorError,
    callLog,
    toolId,
    toolVersion,
  });

  const executorResolver = createMemoryExecutorResolver(
    options.withExecutor === false
      ? []
      : [{ tool_id: toolId, tool_version: toolVersion, executor }],
  );

  const router = createToolRouter({
    registry,
    permissionService,
    executorResolver,
    auditService,
    ...(auditSink ? { auditSink } : {}),
    ...(idempotencyService ? { idempotencyService } : {}),
    ...(approvalService ? { approvalService } : {}),
    ...(observabilityService ? { observabilityService } : {}),
  });

  return {
    router,
    registry,
    permissionService,
    executorResolver,
    executor,
    auditService,
    auditSink,
    idempotencyService,
    approvalService,
    observabilityService,
    callLog,
  };
}

/** Variante écriture payment.create_attempt avec sortie conforme. */
export function createWriteRouterTestHarness(
  options: {
    permissionMode?: "allow" | "deny" | "require_approval";
    withExecutor?: boolean;
    executorResult?: unknown;
    executorError?: unknown | (() => unknown);
    /** Aligné sur `createRouterTestHarness` (défaut : spy audit). */
    withAuditSink?: boolean | SpyAuditSinkOptions;
    withIdempotency?: boolean | SpyIdempotencyService;
    withApproval?: boolean | SpyApprovalService;
    withObservability?:
      | boolean
      | SpyObservabilityService
      | SpyObservabilityServiceOptions;
  } = {},
): RouterTestHarness {
  return createRouterTestHarness({
    ...options,
    toolId: "payment.create_attempt",
    toolVersion: "1.0.0",
    executorResult:
      options.executorResult ?? validPaymentCreateAttemptOutput(),
  });
}

export function createHarnessWithCustomExecutor(
  executor: SpyToolExecutor,
  toolId = "invoice.get",
  toolVersion = "1.0.0",
): RouterTestHarness {
  const callLog = createCallLog();
  const registry = createMemoryToolRegistry(memoryDefinitions);
  const permissionService = createFakePermissionService({
    mode: "allow",
    callLog,
  });
  const auditService = createSpyAuditService();
  const auditSink = createSpyAuditSink();
  const executorResolver = createMemoryExecutorResolver([
    { tool_id: toolId, tool_version: toolVersion, executor },
  ]);
  const router = createToolRouter({
    registry,
    permissionService,
    executorResolver,
    auditService,
    auditSink,
  });
  return {
    router,
    registry,
    permissionService,
    executorResolver,
    executor,
    auditService,
    auditSink,
    idempotencyService: null,
    approvalService: null,
    observabilityService: null,
    callLog,
  };
}

export { createControlledIdempotencyService, createSpyIdempotencyService };
export { createSpyApprovalService };
export { createFixedResultExecutor };
export { createSpyObservabilityService };
