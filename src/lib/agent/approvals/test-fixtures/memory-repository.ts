/**
 * Repository mémoire G1-H — simule la machine d’état SQL pour tests unitaires.
 * Aucun réseau. Sémantique alignée sur create/decide/consume/get_status RPC.
 */

import { randomUUID } from "node:crypto";

import { ApprovalError } from "@/lib/agent/approvals";
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
  ApprovalStatus,
  AutonomyLevel,
  AgentMode,
} from "@/lib/agent/approvals";

type MemoryApprovalRow = {
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
  requester_actor_id: string;
  requester_actor_type: string;
  status: ApprovalStatus;
  requested_at: string;
  expires_at: string;
  decided_at: string | null;
  decided_by_actor_id: string | null;
  decision_reason_code: string | null;
  consumed_at: string | null;
  consumed_by_correlation_id: string | null;
  consumed_idempotency_key_hash: string | null;
};

export type MemoryApprovalRepository = ApprovalRepository & {
  rows: Map<string, MemoryApprovalRow>;
  createCalls: ApprovalRepositoryCreateParams[];
  decideCalls: ApprovalRepositoryDecideParams[];
  inspectCalls: ApprovalRepositoryInspectParams[];
  consumeCalls: ApprovalRepositoryConsumeParams[];
  setNextCreateError: (error: unknown | null) => void;
  setNextDecideError: (error: unknown | null) => void;
  setNextInspectError: (error: unknown | null) => void;
  setNextConsumeError: (error: unknown | null) => void;
  reset: () => void;
  getById: (approvalId: string) => MemoryApprovalRow | undefined;
};

function isExpired(expiresAt: string, now: string): boolean {
  return Date.parse(expiresAt) <= Date.parse(now);
}

function scopeMismatch(
  row: MemoryApprovalRow,
  params: ApprovalRepositoryConsumeParams,
): "autonomy_mismatch" | "scope_mismatch" | null {
  if (row.requested_autonomy_level !== params.requested_autonomy_level) {
    return "autonomy_mismatch";
  }
  if (
    row.request_fingerprint !== params.request_fingerprint ||
    row.tool_id !== params.tool_id ||
    row.tool_version !== params.tool_version ||
    row.mode !== params.mode ||
    row.resource_kind !== params.resource_kind ||
    row.resource_id !== params.resource_id
  ) {
    return "scope_mismatch";
  }
  return null;
}

export function createMemoryApprovalRepository(): MemoryApprovalRepository {
  const rows = new Map<string, MemoryApprovalRow>();
  const createCalls: ApprovalRepositoryCreateParams[] = [];
  const decideCalls: ApprovalRepositoryDecideParams[] = [];
  const inspectCalls: ApprovalRepositoryInspectParams[] = [];
  const consumeCalls: ApprovalRepositoryConsumeParams[] = [];
  let nextCreateError: unknown | null = null;
  let nextDecideError: unknown | null = null;
  let nextInspectError: unknown | null = null;
  let nextConsumeError: unknown | null = null;

  const repo: MemoryApprovalRepository = {
    rows,
    createCalls,
    decideCalls,
    inspectCalls,
    consumeCalls,
    setNextCreateError(error) {
      nextCreateError = error;
    },
    setNextDecideError(error) {
      nextDecideError = error;
    },
    setNextInspectError(error) {
      nextInspectError = error;
    },
    setNextConsumeError(error) {
      nextConsumeError = error;
    },
    reset() {
      rows.clear();
      createCalls.length = 0;
      decideCalls.length = 0;
      inspectCalls.length = 0;
      consumeCalls.length = 0;
      nextCreateError = null;
      nextDecideError = null;
      nextInspectError = null;
      nextConsumeError = null;
    },
    getById(approvalId) {
      return rows.get(approvalId);
    },

    async create(
      params: ApprovalRepositoryCreateParams,
    ): Promise<ApprovalRepositoryCreateResult> {
      createCalls.push(params);
      if (nextCreateError !== null) {
        const err = nextCreateError;
        nextCreateError = null;
        throw err;
      }

      if (Date.parse(params.expires_at) <= Date.parse(params.now)) {
        throw new ApprovalError("APPROVAL_INPUT_INVALID");
      }

      const row: MemoryApprovalRow = {
        approval_id: randomUUID(),
        tenant_id: params.tenant_id,
        request_fingerprint: params.request_fingerprint,
        params_hash: params.params_hash,
        tool_id: params.tool_id,
        tool_version: params.tool_version,
        mode: params.mode,
        requested_autonomy_level: params.requested_autonomy_level,
        resource_kind: params.resource_kind,
        resource_id: params.resource_id,
        requester_actor_id: params.requester_actor_id,
        requester_actor_type: params.requester_actor_type,
        status: "pending",
        requested_at: params.now,
        expires_at: params.expires_at,
        decided_at: null,
        decided_by_actor_id: null,
        decision_reason_code: null,
        consumed_at: null,
        consumed_by_correlation_id: null,
        consumed_idempotency_key_hash: null,
      };
      rows.set(row.approval_id, row);
      return {
        approval_id: row.approval_id,
        status: "pending",
        requested_at: row.requested_at,
        expires_at: row.expires_at,
      };
    },

    async decide(
      params: ApprovalRepositoryDecideParams,
    ): Promise<ApprovalRepositoryDecideResult> {
      decideCalls.push(params);
      if (nextDecideError !== null) {
        const err = nextDecideError;
        nextDecideError = null;
        throw err;
      }

      const row = rows.get(params.approval_id);
      if (!row || row.tenant_id !== params.tenant_id) {
        throw new ApprovalError("APPROVAL_NOT_FOUND");
      }

      if (
        (row.status === "pending" || row.status === "approved") &&
        isExpired(row.expires_at, params.now)
      ) {
        row.status = "expired";
        throw new ApprovalError("APPROVAL_EXPIRED");
      }

      if (row.status === "expired") {
        throw new ApprovalError("APPROVAL_EXPIRED");
      }
      if (row.status === "consumed") {
        throw new ApprovalError("APPROVAL_ALREADY_CONSUMED");
      }
      if (row.status !== "pending") {
        throw new ApprovalError("APPROVAL_DECISION_FAILED");
      }

      if (!params.decided_by_actor_id.trim()) {
        throw new ApprovalError("APPROVAL_ACTOR_UNAUTHORIZED");
      }

      const status = params.decision === "approve" ? "approved" : "rejected";
      row.status = status;
      row.decided_at = params.now;
      row.decided_by_actor_id = params.decided_by_actor_id;
      row.decision_reason_code = params.decision_reason_code;

      return {
        approval_id: row.approval_id,
        status,
        decision: params.decision,
        decided_at: params.now,
      };
    },

    async inspect(
      params: ApprovalRepositoryInspectParams,
    ): Promise<ApprovalRepositoryInspectResult> {
      inspectCalls.push(params);
      if (nextInspectError !== null) {
        const err = nextInspectError;
        nextInspectError = null;
        throw err;
      }

      const row = rows.get(params.approval_id);
      if (!row || row.tenant_id !== params.tenant_id) {
        return { found: false };
      }

      return {
        found: true,
        approval_id: row.approval_id,
        tenant_id: row.tenant_id,
        status: row.status,
        request_fingerprint: row.request_fingerprint,
        params_hash: row.params_hash,
        tool_id: row.tool_id,
        tool_version: row.tool_version,
        mode: row.mode,
        requested_autonomy_level: row.requested_autonomy_level,
        resource_kind: row.resource_kind,
        resource_id: row.resource_id,
        requested_at: row.requested_at,
        expires_at: row.expires_at,
        decided_at: row.decided_at,
        decided_by_actor_id: row.decided_by_actor_id,
        decision_reason_code: row.decision_reason_code,
        consumed_at: row.consumed_at,
        consumed_by_correlation_id: row.consumed_by_correlation_id,
      };
    },

    async consume(
      params: ApprovalRepositoryConsumeParams,
    ): Promise<ApprovalRepositoryConsumeResult> {
      consumeCalls.push(params);
      if (nextConsumeError !== null) {
        const err = nextConsumeError;
        nextConsumeError = null;
        throw err;
      }

      const row = rows.get(params.approval_id);
      if (!row || row.tenant_id !== params.tenant_id) {
        return {
          sql_result: "not_found",
          approval_id: null,
          status: null,
          consumed_at: null,
        };
      }

      if (row.status === "consumed") {
        return {
          sql_result: "already_consumed",
          approval_id: row.approval_id,
          status: row.status,
          consumed_at: row.consumed_at,
        };
      }

      if (row.status === "pending") {
        if (isExpired(row.expires_at, params.now)) {
          row.status = "expired";
          return {
            sql_result: "expired",
            approval_id: row.approval_id,
            status: row.status,
            consumed_at: null,
          };
        }
        return {
          sql_result: "pending",
          approval_id: row.approval_id,
          status: row.status,
          consumed_at: null,
        };
      }

      if (row.status === "rejected") {
        return {
          sql_result: "rejected",
          approval_id: row.approval_id,
          status: row.status,
          consumed_at: null,
        };
      }

      if (row.status === "expired") {
        return {
          sql_result: "expired",
          approval_id: row.approval_id,
          status: row.status,
          consumed_at: null,
        };
      }

      if (row.status === "cancelled") {
        return {
          sql_result: "unavailable",
          approval_id: row.approval_id,
          status: row.status,
          consumed_at: null,
        };
      }

      if (row.status !== "approved") {
        return {
          sql_result: "unavailable",
          approval_id: row.approval_id,
          status: row.status,
          consumed_at: null,
        };
      }

      if (isExpired(row.expires_at, params.now)) {
        row.status = "expired";
        return {
          sql_result: "expired",
          approval_id: row.approval_id,
          status: row.status,
          consumed_at: null,
        };
      }

      const mismatch = scopeMismatch(row, params);
      if (mismatch) {
        return {
          sql_result: mismatch,
          approval_id: row.approval_id,
          status: row.status,
          consumed_at: null,
        };
      }

      if (row.params_hash !== params.params_hash) {
        return {
          sql_result: "params_mismatch",
          approval_id: row.approval_id,
          status: row.status,
          consumed_at: null,
        };
      }

      row.status = "consumed";
      row.consumed_at = params.now;
      row.consumed_by_correlation_id = params.correlation_id;
      row.consumed_idempotency_key_hash = params.idempotency_key_hash;

      return {
        sql_result: "consumed",
        approval_id: row.approval_id,
        status: "consumed",
        consumed_at: row.consumed_at,
      };
    },
  };

  return repo;
}
