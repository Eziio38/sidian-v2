/**
 * Contrat repository d’approbation humaine (G1-H).
 * Le Router dépend de `HumanApprovalService`, pas de ce repository ni de Supabase.
 * Aligné sur RPC migration G1-H :
 * create_human_approval / decide_human_approval /
 * consume_human_approval / get_human_approval_status.
 */

import type {
  AgentMode,
  ApprovalDecision,
  ApprovalResource,
  ApprovalSqlConsumeResult,
  ApprovalStatus,
  AutonomyLevel,
} from "./types";

export type ApprovalRepositoryCreateParams = {
  tenant_id: string;
  request_fingerprint: string;
  params_hash: string;
  tool_id: string;
  tool_version: string;
  mode: AgentMode;
  requested_autonomy_level: AutonomyLevel;
  resource_kind: string | null;
  resource_id: string | null;
  requester_actor_id: string;
  requester_actor_type: string;
  now: string;
  expires_at: string;
};

export type ApprovalRepositoryCreateResult = {
  approval_id: string;
  status: "pending";
  requested_at: string;
  expires_at: string;
};

export type ApprovalRepositoryDecideParams = {
  approval_id: string;
  tenant_id: string;
  decision: ApprovalDecision;
  decided_by_actor_id: string;
  decision_reason_code: string;
  now: string;
};

export type ApprovalRepositoryDecideResult = {
  approval_id: string;
  status: "approved" | "rejected";
  decision: ApprovalDecision;
  decided_at: string;
};

export type ApprovalRepositoryInspectParams = {
  approval_id: string;
  tenant_id: string;
  now: string;
};

export type ApprovalRepositoryInspectFound = {
  found: true;
  approval_id: string;
  tenant_id: string;
  status: ApprovalStatus;
  request_fingerprint: string;
  params_hash: string;
  tool_id: string;
  tool_version: string;
  mode: AgentMode;
  requested_autonomy_level: AutonomyLevel;
  resource_kind: string | null;
  resource_id: string | null;
  requested_at: string;
  expires_at: string;
  decided_at: string | null;
  decided_by_actor_id: string | null;
  decision_reason_code: string | null;
  consumed_at: string | null;
  consumed_by_correlation_id: string | null;
};

export type ApprovalRepositoryInspectMissing = {
  found: false;
};

export type ApprovalRepositoryInspectResult =
  | ApprovalRepositoryInspectFound
  | ApprovalRepositoryInspectMissing;

export type ApprovalRepositoryConsumeParams = {
  approval_id: string;
  tenant_id: string;
  request_fingerprint: string;
  params_hash: string;
  tool_id: string;
  tool_version: string;
  mode: AgentMode;
  requested_autonomy_level: AutonomyLevel;
  resource_kind: string | null;
  resource_id: string | null;
  correlation_id: string;
  idempotency_key_hash: string;
  now: string;
};

export type ApprovalRepositoryConsumeResult = {
  sql_result: ApprovalSqlConsumeResult;
  approval_id: string | null;
  status: ApprovalStatus | null;
  consumed_at: string | null;
};

export type ApprovalRepository = {
  create(
    params: ApprovalRepositoryCreateParams,
  ): Promise<ApprovalRepositoryCreateResult>;
  decide(
    params: ApprovalRepositoryDecideParams,
  ): Promise<ApprovalRepositoryDecideResult>;
  inspect(
    params: ApprovalRepositoryInspectParams,
  ): Promise<ApprovalRepositoryInspectResult>;
  consume(
    params: ApprovalRepositoryConsumeParams,
  ): Promise<ApprovalRepositoryConsumeResult>;
};

/** Helper — extrait kind/id ressource pour les params RPC. */
export function resourceColumns(
  resource: ApprovalResource | undefined,
): { resource_kind: string | null; resource_id: string | null } {
  if (!resource) {
    return { resource_kind: null, resource_id: null };
  }
  return {
    resource_kind: resource.kind,
    resource_id: resource.resource_id,
  };
}
