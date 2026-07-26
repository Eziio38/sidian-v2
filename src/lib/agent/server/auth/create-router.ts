/**
 * Câblage ToolRouter de production pour le point d’entrée HTTP (G1-L / G1-M / G1-N).
 *
 * - Registry / Permission / Audit service : purs ou définitions locales ;
 * - Audit sink / Idempotency / Approvals / Protection drafts : **service_role** ;
 * - Observability : sink null (best-effort, zéro I/O réseau) ;
 * - Executor : G1-M protection.draft.* + G1-N protection.draft.converse ;
 *   invoice.get + notification.generate_draft (P0 Runtime notifications) ;
 *   payment.create_attempt (P0 Runtime payments, fail-closed) ;
 *   provider LLM via `src/lib/llm` (disabled/stub → déterministe ; live →
 *   fail-closed si config absente) ; autres outils fail-closed.
 *
 * Aucune logique Permission/Idempotency dans la route — uniquement injection.
 */

import "server-only";

import {
  createAuditService,
} from "@/lib/agent/audit";
import {
  asAuditSink,
  createSupabaseAuditRepository,
} from "@/lib/agent/audit/persistence";
import { createSupabaseHumanApprovalService } from "@/lib/agent/approvals";
import { createSupabaseIdempotencyService } from "@/lib/agent/idempotency";
import {
  createObservabilityService,
  NullObservabilitySink,
} from "@/lib/agent/observability";
import { createPermissionService } from "@/lib/agent/permissions";
import {
  createProtectionDraftExecutors,
  createSupabaseProtectionDraftService,
} from "@/lib/agent/protection-draft";
import {
  createConversationalRuntimeServiceExecutors,
} from "@/lib/agent/conversational-runtime";
import {
  createToolRouter,
  type ToolRouter,
  type ToolRouterRegistry,
} from "@/lib/agent/router";
import type { ResolveToolExecutor } from "@/lib/agent/router/executor";
import { loadProductionRegistry } from "@/lib/agent/tools";
import type { ToolDefinition } from "@/lib/agent/tools/definition-schema";
import { resolveConversationalLlmProvider } from "@/lib/llm";
import {
  createInvoiceGetService,
  createNotificationDraftService,
  createNotificationRuntimeExecutors,
  createSupabaseCreanceLookup,
  type CreanceLookupClient,
} from "@/lib/runtime/notifications";
import {
  createPaymentRuntimeExecutors,
  createPaymentRuntimeService,
  createSupabasePaymentAttemptRepository,
  createSupabasePaymentJobRepository,
} from "@/lib/runtime/payments";

import {
  createAgentPersistenceClient,
  type AgentPersistenceSupabaseClient,
} from "./service-role";

function readPaymentsEnabledFlag(): boolean {
  return process.env.NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED === "true";
}

function asRouterRegistry(
  getDefinition: (toolId: string, version: string) => ToolDefinition | null,
): ToolRouterRegistry {
  return {
    get(toolId, version) {
      return getDefinition(toolId, version);
    },
  };
}

function safeGetFromProduction(
  toolId: string,
  version: string,
): ToolDefinition | null {
  const registry = loadProductionRegistry();
  try {
    return registry.get(toolId, version);
  } catch {
    return null;
  }
}

function composeExecutorResolvers(
  ...resolvers: ResolveToolExecutor[]
): ResolveToolExecutor {
  return (toolId, version) => {
    for (const resolve of resolvers) {
      const executor = resolve(toolId, version);
      if (executor) return executor;
    }
    return undefined;
  };
}

let cachedRouterPromise: Promise<ToolRouter> | null = null;

/**
 * Construit (et met en cache module) le Router production + deps service_role.
 */
export async function getAgentHttpToolRouter(): Promise<ToolRouter> {
  if (!cachedRouterPromise) {
    cachedRouterPromise = buildAgentHttpToolRouter();
  }
  return cachedRouterPromise;
}

/**
 * Variante testable : client de persistance injecté (toujours service_role
 * sémantique — jamais un JWT utilisateur).
 *
 * Provider LLM G1-N : résolu via SIDIAN_LLM_* (disabled/stub → déterministe
 * sans réseau ; live → OpenAI-compatible, fail-closed si clé absente).
 */
export async function buildAgentHttpToolRouter(
  persistenceClient?: AgentPersistenceSupabaseClient,
): Promise<ToolRouter> {
  const admin = persistenceClient ?? (await createAgentPersistenceClient());

  const registry = asRouterRegistry(safeGetFromProduction);
  const permissionService = createPermissionService({
    resolveToolDefinition: safeGetFromProduction,
  });

  const auditService = createAuditService();
  const auditSink = asAuditSink(createSupabaseAuditRepository(admin));
  const idempotencyService = createSupabaseIdempotencyService(admin);
  const approvalService = createSupabaseHumanApprovalService(admin);
  const observabilityService = createObservabilityService({
    sink: new NullObservabilitySink(),
  });

  const protectionDraftService = createSupabaseProtectionDraftService(admin);
  const protectionDraftExecutors =
    createProtectionDraftExecutors(protectionDraftService);

  // G1-N — runtime conversationnel branché sur src/lib/llm (P0)
  const conversationalExecutors = createConversationalRuntimeServiceExecutors({
    provider: resolveConversationalLlmProvider(),
    draftService: protectionDraftService,
  });

  // P0 Runtime — invoice.get (créance) + notification.generate_draft (brouillon only)
  const creanceLookup = createSupabaseCreanceLookup(
    admin as unknown as CreanceLookupClient,
  );
  const notificationExecutors = createNotificationRuntimeExecutors({
    invoiceGet: createInvoiceGetService(creanceLookup),
    notificationDraft: createNotificationDraftService(creanceLookup),
  });

  // P0 Runtime — payment.create_attempt (enqueue→drain, fail-closed si checklist incomplete)
  const paymentsEnabled = readPaymentsEnabledFlag();
  const paymentRuntime = createPaymentRuntimeService({
    jobs: createSupabasePaymentJobRepository(admin),
    attempts: createSupabasePaymentAttemptRepository(admin, {
      paymentsEnabled,
    }),
    paymentsEnabled,
  });
  const paymentExecutors = createPaymentRuntimeExecutors(paymentRuntime);

  return createToolRouter({
    registry,
    permissionService,
    executorResolver: composeExecutorResolvers(
      protectionDraftExecutors,
      conversationalExecutors,
      notificationExecutors,
      paymentExecutors,
    ),
    auditService,
    auditSink,
    idempotencyService,
    approvalService,
    observabilityService,
  });
}

/** Invalide le cache (tests / hot-reload contrôlé). */
export function resetAgentHttpToolRouterCache(): void {
  cachedRouterPromise = null;
}
