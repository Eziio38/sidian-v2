/**
 * Types du Permission Service déterministe (G1-C).
 * Aucune I/O — décision pure.
 */

import type { ToolDefinition } from "@/lib/agent/tools/definition-schema";

import type {
  PermissionErrorCode,
  PermissionReasonCode,
} from "./reason-codes";

export type AgentMode = "agir" | "conseiller" | "transmettre";

export type ActorType = "human" | "system";

export type AutonomyLevel = 0 | 1 | 2 | 3;

export type ResourceKind = "invoice" | "receivable" | "client" | "account";

export type PermissionGrant = {
  permission: string;
  tenant_id: string;
  resource_id?: string;
};

export type PermissionResource = {
  kind: ResourceKind;
  resource_id: string;
  tenant_id: string;
};

export type HumanValidationStatus =
  | "approved"
  | "pending"
  | "rejected"
  | "expired";

export type HumanValidationRecord = {
  validation_id: string;
  status: HumanValidationStatus;
  /** ISO-8601 ; si présent et status=approved, comparé à context.now */
  expires_at?: string;
  bound_tenant_id: string;
  bound_tool_id: string;
  bound_tool_version: string;
  bound_mode: AgentMode;
  bound_resource?: PermissionResource;
  bound_params_hash: string;
};

/**
 * Requête d’autorisation — identifiants et éléments fournis par l’appelant uniquement.
 * Jamais de ToolDefinition arbitraire ici.
 */
export type PermissionRequest = {
  actor_id: string;
  actor_type: ActorType;
  tenant_id: string;
  correlation_id: string;
  tool_id: string;
  tool_version: string;
  mode: AgentMode;
  requested_autonomy_level: AutonomyLevel;
  grants: PermissionGrant[];
  resource?: PermissionResource;
  human_validation?: HumanValidationRecord;
  /** Empreinte des paramètres actuels (obligatoire si validation humaine requise). */
  current_params_hash?: string;
};

/** Contexte d’évaluation — horloge injectée obligatoire (déterminisme). */
export type PermissionEvaluationContext = {
  now: string;
};

export type PermissionDecisionOutcome = "allow" | "deny" | "require_approval";

export type PermissionDecisionScope = {
  tenant_id: string;
  resource_id?: string;
};

export type PermissionDecisionAutonomy = {
  requested: AutonomyLevel | null;
  maximum: AutonomyLevel | null;
};

export type PermissionDecision = {
  decision: PermissionDecisionOutcome;
  reason_code: PermissionReasonCode;
  policy_version: string;
  scope: PermissionDecisionScope;
  checks: string[];
  failed_check?: string;
  required_permissions: string[];
  matching_grants: PermissionGrant[];
  tool_id: string | null;
  tool_version: string | null;
  mode: AgentMode | null;
  autonomy: PermissionDecisionAutonomy;
  human_validation_required: boolean;
  error_code?: PermissionErrorCode;
};

/** Dépendance de confiance injectée — résolution hors requête. */
export type ResolveToolDefinition = (
  toolId: string,
  version: string,
) => ToolDefinition | null;

export type PermissionServiceDependencies = {
  resolveToolDefinition: ResolveToolDefinition;
};

export type PermissionService = {
  authorize(
    request: unknown,
    context: unknown,
  ): PermissionDecision;
};
