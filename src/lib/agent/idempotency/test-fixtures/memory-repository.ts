/**
 * Repository mémoire G1-G — simule la machine d’état SQL pour tests unitaires.
 * Aucun réseau. Sémantique alignée sur claim_idempotency_key / complete / fail.
 */

import { randomUUID } from "node:crypto";

import { IdempotencyError } from "@/lib/agent/idempotency";
import type {
  IdempotencyRepository,
  IdempotencyRepositoryClaimParams,
  IdempotencyRepositoryClaimResult,
  IdempotencyRepositoryCompleteParams,
  IdempotencyRepositoryFailParams,
  IdempotencyTerminalResult,
} from "@/lib/agent/idempotency";

type MemoryRecord = {
  id: string;
  tenant_id: string;
  idempotency_key: string;
  request_fingerprint: string;
  correlation_id: string;
  tool_id: string;
  tool_version: string;
  resource_kind: string | null;
  resource_id: string | null;
  mode: string;
  status: "in_progress" | "succeeded" | "failed";
  owner_token_hash: string | null;
  started_at: string;
  expires_at: string;
  completed_at: string | null;
  terminal_result: IdempotencyTerminalResult | null;
  terminal_result_hash: string | null;
  failure_code: string | null;
};

export type MemoryIdempotencyRepository = IdempotencyRepository & {
  records: Map<string, MemoryRecord>;
  claimCalls: IdempotencyRepositoryClaimParams[];
  completeCalls: IdempotencyRepositoryCompleteParams[];
  failCalls: IdempotencyRepositoryFailParams[];
  /** Force la prochaine erreur claim (infra). */
  setNextClaimError: (error: unknown | null) => void;
  setNextCompleteError: (error: unknown | null) => void;
  setNextFailError: (error: unknown | null) => void;
  reset: () => void;
  getByKey: (tenantId: string, key: string) => MemoryRecord | undefined;
};

function recordKey(tenantId: string, idempotencyKey: string): string {
  return `${tenantId}::${idempotencyKey}`;
}

function addSeconds(iso: string, seconds: number): string {
  const ms = Date.parse(iso);
  return new Date(ms + seconds * 1000).toISOString();
}

function isExpired(expiresAt: string, now: string): boolean {
  return Date.parse(expiresAt) <= Date.parse(now);
}

export function createMemoryIdempotencyRepository(): MemoryIdempotencyRepository {
  const records = new Map<string, MemoryRecord>();
  const claimCalls: IdempotencyRepositoryClaimParams[] = [];
  const completeCalls: IdempotencyRepositoryCompleteParams[] = [];
  const failCalls: IdempotencyRepositoryFailParams[] = [];
  let nextClaimError: unknown | null = null;
  let nextCompleteError: unknown | null = null;
  let nextFailError: unknown | null = null;

  const repo: MemoryIdempotencyRepository = {
    records,
    claimCalls,
    completeCalls,
    failCalls,
    setNextClaimError(error) {
      nextClaimError = error;
    },
    setNextCompleteError(error) {
      nextCompleteError = error;
    },
    setNextFailError(error) {
      nextFailError = error;
    },
    reset() {
      records.clear();
      claimCalls.length = 0;
      completeCalls.length = 0;
      failCalls.length = 0;
      nextClaimError = null;
      nextCompleteError = null;
      nextFailError = null;
    },
    getByKey(tenantId, key) {
      return records.get(recordKey(tenantId, key));
    },

    async claim(
      params: IdempotencyRepositoryClaimParams,
    ): Promise<IdempotencyRepositoryClaimResult> {
      claimCalls.push(params);
      if (nextClaimError !== null) {
        const err = nextClaimError;
        nextClaimError = null;
        throw err;
      }

      const key = recordKey(params.tenant_id, params.idempotency_key);
      const existing = records.get(key);
      const expiresAt = addSeconds(params.now, params.ttl_seconds);

      if (!existing) {
        const row: MemoryRecord = {
          id: randomUUID(),
          tenant_id: params.tenant_id,
          idempotency_key: params.idempotency_key,
          request_fingerprint: params.request_fingerprint,
          correlation_id: params.correlation_id,
          tool_id: params.tool_id,
          tool_version: params.tool_version,
          resource_kind: params.resource_kind,
          resource_id: params.resource_id,
          mode: params.mode,
          status: "in_progress",
          owner_token_hash: params.owner_token_hash,
          started_at: params.now,
          expires_at: expiresAt,
          completed_at: null,
          terminal_result: null,
          terminal_result_hash: null,
          failure_code: null,
        };
        records.set(key, row);
        return {
          sql_decision: "acquired",
          record_id: row.id,
          expires_at: row.expires_at,
          terminal_result: null,
          terminal_result_hash: null,
          failure_code: null,
        };
      }

      if (existing.request_fingerprint !== params.request_fingerprint) {
        return {
          sql_decision: "conflict",
          record_id: existing.id,
          expires_at: existing.expires_at,
          terminal_result: null,
          terminal_result_hash: null,
          failure_code: null,
        };
      }

      if (existing.status === "succeeded") {
        return {
          sql_decision: "replay_succeeded",
          record_id: existing.id,
          expires_at: existing.expires_at,
          terminal_result: existing.terminal_result,
          terminal_result_hash: existing.terminal_result_hash,
          failure_code: null,
        };
      }

      if (existing.status === "failed") {
        return {
          sql_decision: "replay_failed",
          record_id: existing.id,
          expires_at: existing.expires_at,
          terminal_result: existing.terminal_result,
          terminal_result_hash: existing.terminal_result_hash,
          failure_code: existing.failure_code,
        };
      }

      // in_progress
      if (!isExpired(existing.expires_at, params.now)) {
        return {
          sql_decision: "in_progress",
          record_id: existing.id,
          expires_at: existing.expires_at,
          terminal_result: null,
          terminal_result_hash: null,
          failure_code: null,
        };
      }

      existing.request_fingerprint = params.request_fingerprint;
      existing.correlation_id = params.correlation_id;
      existing.tool_id = params.tool_id;
      existing.tool_version = params.tool_version;
      existing.resource_kind = params.resource_kind;
      existing.resource_id = params.resource_id;
      existing.mode = params.mode;
      existing.status = "in_progress";
      existing.owner_token_hash = params.owner_token_hash;
      existing.started_at = params.now;
      existing.expires_at = expiresAt;
      existing.completed_at = null;
      existing.terminal_result = null;
      existing.terminal_result_hash = null;
      existing.failure_code = null;

      return {
        sql_decision: "expired_reacquired",
        record_id: existing.id,
        expires_at: existing.expires_at,
        terminal_result: null,
        terminal_result_hash: null,
        failure_code: null,
      };
    },

    async complete(params: IdempotencyRepositoryCompleteParams): Promise<void> {
      completeCalls.push(params);
      if (nextCompleteError !== null) {
        const err = nextCompleteError;
        nextCompleteError = null;
        throw err;
      }

      const row = findByRecordId(params.record_id);
      if (!row || row.status !== "in_progress") {
        throw new IdempotencyError("IDEMPOTENCY_COMPLETION_FAILED");
      }
      if (row.owner_token_hash !== params.owner_token_hash) {
        throw new IdempotencyError("IDEMPOTENCY_OWNER_MISMATCH");
      }

      row.status = "succeeded";
      row.owner_token_hash = null;
      row.completed_at = params.now;
      row.terminal_result = params.terminal_result;
      row.terminal_result_hash = params.terminal_result_hash;
      row.failure_code = null;
    },

    async fail(params: IdempotencyRepositoryFailParams): Promise<void> {
      failCalls.push(params);
      if (nextFailError !== null) {
        const err = nextFailError;
        nextFailError = null;
        throw err;
      }

      const row = findByRecordId(params.record_id);
      if (!row || row.status !== "in_progress") {
        throw new IdempotencyError("IDEMPOTENCY_COMPLETION_FAILED");
      }
      if (row.owner_token_hash !== params.owner_token_hash) {
        throw new IdempotencyError("IDEMPOTENCY_OWNER_MISMATCH");
      }

      row.status = "failed";
      row.owner_token_hash = null;
      row.completed_at = params.now;
      row.terminal_result = params.terminal_result;
      row.terminal_result_hash = params.terminal_result_hash;
      row.failure_code = params.failure_code;
    },
  };

  function findByRecordId(recordId: string): MemoryRecord | undefined {
    for (const row of records.values()) {
      if (row.id === recordId) return row;
    }
    return undefined;
  }

  return repo;
}
