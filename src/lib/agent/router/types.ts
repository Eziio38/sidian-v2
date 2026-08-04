/**
 * Types du Tool Router déterministe (G1-D + trust boundary G1-K).
 * Orchestration uniquement — aucune I/O métier.
 * Identité / tenant / grants : uniquement depuis TrustedExecutionContext.
 */

import type { AuditEvent, AuditService } from "@/lib/agent/audit";
import type { AuditSink } from "@/lib/agent/audit/persistence";
import type { HumanApprovalService } from "@/lib/agent/approvals";
import type {
  TrustedExecutionContext,
} from "@/lib/agent/gateway/types";
import type { IdempotencyService } from "@/lib/agent/idempotency";
import type {
  ObservabilityEvent,
  ObservabilityService,
} from "@/lib/agent/observability";
import type {
  ActorType,
  AgentMode,
  AutonomyLevel,
  HumanValidationRecord,
  HumanValidationStatus,
  PermissionGrant,
  PermissionResource,
  PermissionService,
  ResourceKind,
} from "@/lib/agent/permissions/types";
import type { ToolDefinition } from "@/lib/agent/tools/definition-schema";

import type { RouterErrorCategory, RouterErrorCode } from "./error-codes";
import type { ResolveToolExecutor, ToolExecutor } from "./executor";

export type {
  ActorType,
  AgentMode,
  AutonomyLevel,
  HumanValidationStatus,
  ResolveToolExecutor,
  ResourceKind,
  RouterErrorCategory,
  RouterErrorCode,
  ToolExecutor,
  TrustedExecutionContext,
};

export type ToolRouteActor = {
  actor_id: string;
  actor_type: ActorType;
};

export type ToolRouteTenant = {
  tenant_id: string;
};

export type ToolRouteToolRef = {
  tool_id: string;
  tool_version: string;
};

export type ToolRouteIntention = {
  mode: AgentMode;
  requested_autonomy_level: AutonomyLevel;
};

/** Alias G1-C — grants dérivés serveur (jamais body). */
export type ToolRouteGrant = PermissionGrant;

/**
 * Ressource dans l’intention — **sans** tenant_id (ancré via TrustedExecutionContext).
 */
export type ToolRouteResourceRef = {
  kind: ResourceKind;
  resource_id: string;
};

/** Alias G1-C — ressource scopée tenant (construite serveur). */
export type ToolRouteResource = PermissionResource;

/** Alias G1-C — validation humaine liée outil/tenant/hash. */
export type ToolRouteHumanValidation = HumanValidationRecord;

/**
 * Intention outil validée — **sans** identité déclarative.
 * Interdit : tenant_id, actor_id, actor_type, roles, permissions, grants,
 * membership, claims, service_role, human_validation déclaratif.
 * Uniquement `approval_id` (G1-H) comme référence d’approbation.
 */
export type ValidatedToolIntent = {
  tool_id: string;
  tool_version: string;
  mode: AgentMode;
  requested_autonomy_level: AutonomyLevel;
  arguments: unknown;
  resource?: ToolRouteResourceRef;
  approval_id?: string;
  correlation_id?: string;
  idempotency_key?: string;
};

/**
 * @deprecated Ancien contrat déclaratif (G1-D…J) — **retiré**.
 * Utiliser `ValidatedToolIntent` + `TrustedExecutionContext`.
 * Conservé comme type jamais exposé par `route()` pour éviter coexistence.
 */
export type ToolRouteRequest = never;

/**
 * Contexte Router = TrustedExecutionContext (G1-K).
 * Remplace l’ancien `{ now, correlation_id? }` déclaratif.
 */
export type ToolRouteContext = TrustedExecutionContext;

export type ToolRouteErrorDetails = Record<string, unknown>;

export type ToolRouteError = {
  code: RouterErrorCode;
  category: RouterErrorCategory;
  message: string;
  details?: ToolRouteErrorDetails;
};

export type ToolRouteSuccess = {
  status: "success";
  tool_id: string;
  tool_version: string;
  correlation_id: string;
  output: unknown;
  audit?: AuditEvent;
  observability?: ObservabilityEvent;
  observability_degraded?: boolean;
};

export type ToolRouteBlocked = {
  status: "blocked";
  tool_id?: string;
  tool_version?: string;
  correlation_id?: string;
  error: ToolRouteError;
  audit?: AuditEvent;
  observability?: ObservabilityEvent;
  observability_degraded?: boolean;
};

export type ToolRouteResult = ToolRouteSuccess | ToolRouteBlocked;

export type ToolRouterRegistry = {
  get(toolId: string, version: string): ToolDefinition | null;
};

export type ToolRouterDependencies = {
  registry: ToolRouterRegistry;
  permissionService: PermissionService;
  executorResolver: ResolveToolExecutor;
  auditService?: AuditService;
  auditSink?: AuditSink;
  idempotencyService?: IdempotencyService;
  approvalService?: HumanApprovalService;
  observabilityService?: ObservabilityService;
};

/**
 * Contrat public G1-K — `route(intent, trustedContext)`.
 * L’ancien chemin déclaratif (actor/tenant/grants dans request) est inaccessible.
 */
export type ToolRouter = {
  route(
    request: ValidatedToolIntent | unknown,
    context: TrustedExecutionContext | unknown,
  ): Promise<ToolRouteResult>;
};
