/**
 * Repository Supabase pour les approbations humaines (G1-H).
 * Client injecté — appels RPC atomiques uniquement.
 * Aligné sur create_human_approval / decide_human_approval /
 * consume_human_approval / get_human_approval_status.
 * Jamais d’exposition SQL / stack / token / secret / args complets.
 */

import {
  ApprovalError,
  APPROVAL_SAFE_MESSAGES,
  type ApprovalErrorCode,
} from "./errors";
import {
  approvalSqlConsumeResponseSchema,
  approvalSqlCreateResponseSchema,
  approvalSqlDecideResponseSchema,
  approvalSqlStatusResponseSchema,
} from "./schemas";
import type {
  ApprovalRepository,
  ApprovalRepositoryConsumeParams,
  ApprovalRepositoryConsumeResult,
  ApprovalRepositoryCreateParams,
  ApprovalRepositoryCreateResult,
  ApprovalRepositoryDecideParams,
  ApprovalRepositoryDecideResult,
  ApprovalRepositoryInspectParams,
  ApprovalRepositoryInspectResult,
} from "./repository";
import {
  APPROVAL_RPC,
  type AgentMode,
  type ApprovalDecision,
  type ApprovalSqlConsumeResult,
  type ApprovalStatus,
  type AutonomyLevel,
} from "./types";

export type ApprovalPostgrestError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

export type ApprovalRpcResult = {
  data: unknown;
  error: ApprovalPostgrestError | null;
};

/**
 * Surface minimale du client Supabase (rpc uniquement).
 * Injectée — aucune création implicite de client global.
 */
export type ApprovalPersistenceClient = {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<ApprovalRpcResult>;
};

const SQL_CONSUME_RESULTS = new Set<string>([
  "consumed",
  "pending",
  "rejected",
  "expired",
  "already_consumed",
  "scope_mismatch",
  "params_mismatch",
  "autonomy_mismatch",
  "not_found",
  "unavailable",
]);

function isTransportFailure(err: unknown): boolean {
  if (err === null || err === undefined) {
    return false;
  }
  if (typeof err !== "object") {
    return true;
  }
  const name = "name" in err ? String(err.name) : "";
  return (
    name === "AbortError" ||
    name === "FetchError" ||
    name === "TypeError" ||
    name === "TimeoutError"
  );
}

function normalizeTimestamp(
  value: string | number | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return new Date(value).toISOString();
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function throwSafe(code: ApprovalErrorCode): never {
  throw new ApprovalError(code, APPROVAL_SAFE_MESSAGES[code]);
}

/**
 * Classe une erreur PostgREST/Postgres sans exposer message/détails SQL.
 */
export function classifyApprovalRpcError(
  error: ApprovalPostgrestError | null | undefined,
  phase: "create" | "decide" | "inspect" | "consume",
): ApprovalErrorCode {
  const code = error?.code?.trim() ?? "";
  const message = (error?.message?.trim() ?? "").toLowerCase();

  if (
    message.includes("human_approval_decided_by_actor_id_invalid") ||
    message.includes("approval_actor_unauthorized") ||
    message.includes("actor_unauthorized")
  ) {
    return "APPROVAL_ACTOR_UNAUTHORIZED";
  }
  if (
    message.includes("human_approval_") &&
    (message.includes("_invalid") ||
      message.includes("_required") ||
      message.includes("_ambiguous") ||
      message.includes("_unsanitized"))
  ) {
    return "APPROVAL_INPUT_INVALID";
  }
  if (
    message.includes("human_approval_tenant_not_found") ||
    message.includes("approval_not_found") ||
    message.includes("not_found")
  ) {
    // tenant_not_found at create → input/request failure, not "approval not found"
    if (message.includes("tenant_not_found")) {
      return phase === "create"
        ? "APPROVAL_REQUEST_FAILED"
        : "APPROVAL_NOT_FOUND";
    }
    return "APPROVAL_NOT_FOUND";
  }
  if (message.includes("approval_expired") || message === "expired") {
    return "APPROVAL_EXPIRED";
  }
  if (
    message.includes("approval_already_consumed") ||
    message.includes("already_consumed")
  ) {
    return "APPROVAL_ALREADY_CONSUMED";
  }
  if (
    message.includes("approval_params_mismatch") ||
    message.includes("params_mismatch")
  ) {
    return "APPROVAL_PARAMS_MISMATCH";
  }
  if (
    message.includes("approval_autonomy_mismatch") ||
    message.includes("autonomy_mismatch")
  ) {
    return "APPROVAL_AUTONOMY_MISMATCH";
  }
  if (
    message.includes("approval_scope_mismatch") ||
    message.includes("scope_mismatch")
  ) {
    return "APPROVAL_SCOPE_MISMATCH";
  }
  if (
    message.includes("approval_pending") ||
    message.includes("still_pending")
  ) {
    return "APPROVAL_PENDING";
  }
  if (
    message.includes("approval_rejected") ||
    message.includes("already_rejected")
  ) {
    return "APPROVAL_REJECTED";
  }

  if (
    code === "PGRST301" ||
    code === "08000" ||
    code === "08001" ||
    code === "08003" ||
    code === "08006" ||
    code === "57P01" ||
    code === "57P02" ||
    code === "57P03"
  ) {
    return "APPROVAL_UNAVAILABLE";
  }

  if (phase === "create") {
    return "APPROVAL_REQUEST_FAILED";
  }
  if (phase === "decide") {
    return "APPROVAL_DECISION_FAILED";
  }
  if (phase === "consume") {
    return "APPROVAL_CONSUMPTION_FAILED";
  }
  return "APPROVAL_UNAVAILABLE";
}

function mapCreatePayload(data: unknown): ApprovalRepositoryCreateResult {
  const parsed = approvalSqlCreateResponseSchema.safeParse(data);
  if (!parsed.success || parsed.data.ok !== true) {
    throwSafe("APPROVAL_REQUEST_FAILED");
  }

  const requestedAt = normalizeTimestamp(parsed.data.requested_at);
  const expiresAt = normalizeTimestamp(parsed.data.expires_at);
  if (!requestedAt || !expiresAt) {
    throwSafe("APPROVAL_REQUEST_FAILED");
  }

  return {
    approval_id: parsed.data.approval_id,
    status: "pending",
    requested_at: requestedAt,
    expires_at: expiresAt,
  };
}

function mapDecidePayload(data: unknown): ApprovalRepositoryDecideResult {
  const parsed = approvalSqlDecideResponseSchema.safeParse(data);
  if (!parsed.success) {
    throwSafe("APPROVAL_DECISION_FAILED");
  }

  const row = parsed.data;
  if (row.ok !== true) {
    const result = row.result.toLowerCase();
    if (result === "not_found") throwSafe("APPROVAL_NOT_FOUND");
    if (result === "expired") throwSafe("APPROVAL_EXPIRED");
    if (result === "already_consumed") throwSafe("APPROVAL_ALREADY_CONSUMED");
    if (result === "unavailable") throwSafe("APPROVAL_DECISION_FAILED");
    throwSafe("APPROVAL_DECISION_FAILED");
  }

  if (!row.approval_id) {
    throwSafe("APPROVAL_DECISION_FAILED");
  }

  const status = row.status;
  if (status !== "approved" && status !== "rejected") {
    throwSafe("APPROVAL_DECISION_FAILED");
  }

  const decidedAt = normalizeTimestamp(row.decided_at);
  if (!decidedAt) {
    throwSafe("APPROVAL_DECISION_FAILED");
  }

  const decision: ApprovalDecision =
    status === "approved" ? "approve" : "reject";

  return {
    approval_id: row.approval_id,
    status,
    decision,
    decided_at: decidedAt,
  };
}

function mapInspectPayload(data: unknown): ApprovalRepositoryInspectResult {
  if (data === null || data === undefined) {
    return { found: false };
  }

  const parsed = approvalSqlStatusResponseSchema.safeParse(data);
  if (!parsed.success) {
    throwSafe("APPROVAL_UNAVAILABLE");
  }

  const row = parsed.data;
  if (row.ok !== true || row.result === "not_found" || !row.approval) {
    return { found: false };
  }

  const approval = row.approval;
  const requestedAt = normalizeTimestamp(approval.requested_at);
  const expiresAt = normalizeTimestamp(approval.expires_at);
  if (!requestedAt || !expiresAt) {
    throwSafe("APPROVAL_UNAVAILABLE");
  }

  return {
    found: true,
    approval_id: approval.approval_id,
    tenant_id: approval.tenant_id,
    status: approval.status as ApprovalStatus,
    request_fingerprint: approval.request_fingerprint,
    params_hash: approval.params_hash,
    tool_id: approval.tool_id,
    tool_version: approval.tool_version,
    mode: approval.mode as AgentMode,
    requested_autonomy_level:
      approval.requested_autonomy_level as AutonomyLevel,
    resource_kind: approval.resource_kind ?? null,
    resource_id: approval.resource_id ?? null,
    requested_at: requestedAt,
    expires_at: expiresAt,
    decided_at: normalizeTimestamp(approval.decided_at ?? null),
    decided_by_actor_id: approval.decided_by_actor_id ?? null,
    decision_reason_code: approval.decision_reason_code ?? null,
    consumed_at: normalizeTimestamp(approval.consumed_at ?? null),
    consumed_by_correlation_id: approval.consumed_by_correlation_id ?? null,
  };
}

function mapConsumePayload(data: unknown): ApprovalRepositoryConsumeResult {
  const parsed = approvalSqlConsumeResponseSchema.safeParse(data);
  if (!parsed.success) {
    throwSafe("APPROVAL_CONSUMPTION_FAILED");
  }

  if (!SQL_CONSUME_RESULTS.has(parsed.data.result)) {
    throwSafe("APPROVAL_CONSUMPTION_FAILED");
  }

  return {
    sql_result: parsed.data.result as ApprovalSqlConsumeResult,
    approval_id: parsed.data.approval_id ?? null,
    status: (parsed.data.status as ApprovalStatus | null | undefined) ?? null,
    consumed_at: normalizeTimestamp(parsed.data.consumed_at),
  };
}

/**
 * Crée le repository de production.
 * @param client Client Supabase (ou surface compatible) **injecté**.
 *   Attendu : service_role pour mutations agent. `p_tenant_id` / actor passés
 *   aux RPC doivent provenir du TrustedExecutionContext (G1-K) — jamais du body
 *   ExternalToolRequest. Les RPC SECURITY DEFINER vérifient l’existence
 *   prestataire et le scope tenant ; elles ne remplacent pas l’ancrage Gateway.
 */
export function createSupabaseApprovalRepository(
  client: ApprovalPersistenceClient,
): ApprovalRepository {
  return {
    async create(
      params: ApprovalRepositoryCreateParams,
    ): Promise<ApprovalRepositoryCreateResult> {
      try {
        const { data, error } = await client.rpc(APPROVAL_RPC.create, {
          p_tenant_id: params.tenant_id,
          p_request_fingerprint: params.request_fingerprint,
          p_params_hash: params.params_hash,
          p_tool_id: params.tool_id,
          p_tool_version: params.tool_version,
          p_mode: params.mode,
          p_requested_autonomy_level: params.requested_autonomy_level,
          p_resource_kind: params.resource_kind,
          p_resource_id: params.resource_id,
          p_requester_actor_id: params.requester_actor_id,
          p_requester_actor_type: params.requester_actor_type,
          p_now: params.now,
          p_expires_at: params.expires_at,
        });

        if (error) {
          throwSafe(classifyApprovalRpcError(error, "create"));
        }
        if (data === null || data === undefined) {
          throwSafe("APPROVAL_UNAVAILABLE");
        }
        return mapCreatePayload(data);
      } catch (err) {
        if (err instanceof ApprovalError) {
          throw err;
        }
        if (isTransportFailure(err)) {
          throwSafe("APPROVAL_UNAVAILABLE");
        }
        throwSafe("APPROVAL_REQUEST_FAILED");
      }
    },

    async decide(
      params: ApprovalRepositoryDecideParams,
    ): Promise<ApprovalRepositoryDecideResult> {
      try {
        const { data, error } = await client.rpc(APPROVAL_RPC.decide, {
          p_approval_id: params.approval_id,
          p_tenant_id: params.tenant_id,
          p_decision: params.decision,
          p_decided_by_actor_id: params.decided_by_actor_id,
          p_decision_reason_code: params.decision_reason_code,
          p_now: params.now,
        });

        if (error) {
          throwSafe(classifyApprovalRpcError(error, "decide"));
        }
        if (data === null || data === undefined) {
          throwSafe("APPROVAL_UNAVAILABLE");
        }
        return mapDecidePayload(data);
      } catch (err) {
        if (err instanceof ApprovalError) {
          throw err;
        }
        if (isTransportFailure(err)) {
          throwSafe("APPROVAL_UNAVAILABLE");
        }
        throwSafe("APPROVAL_DECISION_FAILED");
      }
    },

    async inspect(
      params: ApprovalRepositoryInspectParams,
    ): Promise<ApprovalRepositoryInspectResult> {
      try {
        const { data, error } = await client.rpc(APPROVAL_RPC.status, {
          p_approval_id: params.approval_id,
          p_tenant_id: params.tenant_id,
          p_now: params.now,
        });

        if (error) {
          throwSafe(classifyApprovalRpcError(error, "inspect"));
        }
        return mapInspectPayload(data);
      } catch (err) {
        if (err instanceof ApprovalError) {
          throw err;
        }
        if (isTransportFailure(err)) {
          throwSafe("APPROVAL_UNAVAILABLE");
        }
        throwSafe("APPROVAL_UNAVAILABLE");
      }
    },

    async consume(
      params: ApprovalRepositoryConsumeParams,
    ): Promise<ApprovalRepositoryConsumeResult> {
      try {
        const { data, error } = await client.rpc(APPROVAL_RPC.consume, {
          p_approval_id: params.approval_id,
          p_tenant_id: params.tenant_id,
          p_request_fingerprint: params.request_fingerprint,
          p_params_hash: params.params_hash,
          p_tool_id: params.tool_id,
          p_tool_version: params.tool_version,
          p_mode: params.mode,
          p_requested_autonomy_level: params.requested_autonomy_level,
          p_resource_kind: params.resource_kind,
          p_resource_id: params.resource_id,
          p_correlation_id: params.correlation_id,
          p_idempotency_key_hash: params.idempotency_key_hash,
          p_now: params.now,
        });

        if (error) {
          throwSafe(classifyApprovalRpcError(error, "consume"));
        }
        if (data === null || data === undefined) {
          throwSafe("APPROVAL_UNAVAILABLE");
        }
        return mapConsumePayload(data);
      } catch (err) {
        if (err instanceof ApprovalError) {
          throw err;
        }
        if (isTransportFailure(err)) {
          throwSafe("APPROVAL_UNAVAILABLE");
        }
        throwSafe("APPROVAL_CONSUMPTION_FAILED");
      }
    },
  };
}
