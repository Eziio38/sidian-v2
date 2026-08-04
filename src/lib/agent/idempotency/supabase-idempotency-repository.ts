/**
 * Repository Supabase pour l’idempotence agent (G1-G).
 * Client injecté — appels RPC atomiques uniquement.
 * Aligné sur `supabase/migrations/20260724230000_g1g_agent_idempotency.sql`.
 * Jamais d’exposition SQL / stack / owner token brut.
 */

import {
  IdempotencyError,
  IDEMPOTENCY_SAFE_MESSAGES,
  type IdempotencyErrorCode,
} from "./errors";
import {
  idempotencySqlClaimResponseSchema,
  idempotencySqlMutationResponseSchema,
  idempotencyTerminalResultSchema,
} from "./schemas";
import type {
  IdempotencyRepository,
  IdempotencyRepositoryClaimParams,
  IdempotencyRepositoryClaimResult,
  IdempotencyRepositoryCompleteParams,
  IdempotencyRepositoryFailParams,
} from "./repository";
import {
  IDEMPOTENCY_RPC,
  type IdempotencySqlClaimDecision,
  type IdempotencyTerminalResult,
} from "./types";

export type IdempotencyPostgrestError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

export type IdempotencyRpcResult = {
  data: unknown;
  error: IdempotencyPostgrestError | null;
};

/**
 * Surface minimale du client Supabase (rpc uniquement).
 * Injectée — aucune création implicite de client global.
 */
export type IdempotencyPersistenceClient = {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<IdempotencyRpcResult>;
};

const SQL_DECISIONS = new Set<string>([
  "acquired",
  "replay_succeeded",
  "replay_failed",
  "conflict",
  "in_progress",
  "expired_reacquired",
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

function normalizeExpiresAt(
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

/**
 * Classe une erreur PostgREST/Postgres sans exposer message/détails SQL.
 */
export function classifyIdempotencyRpcError(
  error: IdempotencyPostgrestError | null | undefined,
  phase: "claim" | "complete" | "fail",
): IdempotencyErrorCode {
  const code = error?.code?.trim() ?? "";
  const message = error?.message?.trim() ?? "";

  if (
    message === "idempotency_owner_mismatch" ||
    message.includes("idempotency_owner_mismatch")
  ) {
    return "IDEMPOTENCY_OWNER_MISMATCH";
  }
  if (
    message === "idempotency_key_invalid" ||
    message === "idempotency_key_required" ||
    message.includes("idempotency_key_invalid") ||
    message.includes("idempotency_key_required")
  ) {
    return "IDEMPOTENCY_KEY_REQUIRED";
  }
  if (
    message.includes("idempotency_") &&
    (message.includes("_invalid") ||
      message.includes("_required") ||
      message.includes("_unsanitized"))
  ) {
    return "IDEMPOTENCY_INPUT_INVALID";
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
    return "IDEMPOTENCY_UNAVAILABLE";
  }

  if (phase === "claim") {
    return "IDEMPOTENCY_CLAIM_FAILED";
  }
  return "IDEMPOTENCY_COMPLETION_FAILED";
}

function throwSafe(code: IdempotencyErrorCode): never {
  throw new IdempotencyError(code, IDEMPOTENCY_SAFE_MESSAGES[code]);
}

function parseTerminalResult(
  raw: unknown,
): IdempotencyTerminalResult | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const parsed = idempotencyTerminalResultSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

function mapClaimPayload(data: unknown): IdempotencyRepositoryClaimResult {
  const parsed = idempotencySqlClaimResponseSchema.safeParse(data);
  if (!parsed.success) {
    throwSafe("IDEMPOTENCY_CLAIM_FAILED");
  }

  const row = parsed.data;
  if (!SQL_DECISIONS.has(row.decision)) {
    throwSafe("IDEMPOTENCY_CLAIM_FAILED");
  }

  const terminal = parseTerminalResult(row.terminal_result ?? null);

  if (
    (row.decision === "replay_succeeded" ||
      row.decision === "replay_failed") &&
    terminal === null
  ) {
    throwSafe("IDEMPOTENCY_UNAVAILABLE");
  }

  return {
    sql_decision: row.decision as IdempotencySqlClaimDecision,
    record_id: row.record_id ?? null,
    expires_at: normalizeExpiresAt(row.expires_at),
    terminal_result: terminal,
    terminal_result_hash: row.terminal_result_hash ?? null,
    failure_code: row.failure_code ?? null,
  };
}

function assertMutationOk(data: unknown): void {
  const parsed = idempotencySqlMutationResponseSchema.safeParse(data);
  if (!parsed.success) {
    throwSafe("IDEMPOTENCY_COMPLETION_FAILED");
  }
  if (parsed.data.ok === true) {
    return;
  }
  const errorCode = parsed.data.error_code ?? "";
  if (errorCode === "owner_mismatch") {
    throwSafe("IDEMPOTENCY_OWNER_MISMATCH");
  }
  throwSafe("IDEMPOTENCY_COMPLETION_FAILED");
}

/**
 * Crée le repository de production.
 * @param client Client Supabase (ou surface compatible) **injecté**.
 *   Attendu : service_role pour mutations agent. `p_tenant_id` passé aux RPC
 *   doit être le tenant du TrustedExecutionContext uniquement (G1-K) —
 *   jamais un tenant déclaré par l’appelant externe.
 */
export function createSupabaseIdempotencyRepository(
  client: IdempotencyPersistenceClient,
): IdempotencyRepository {
  return {
    async claim(
      params: IdempotencyRepositoryClaimParams,
    ): Promise<IdempotencyRepositoryClaimResult> {
      try {
        const { data, error } = await client.rpc(IDEMPOTENCY_RPC.claim, {
          p_tenant_id: params.tenant_id,
          p_idempotency_key: params.idempotency_key,
          p_request_fingerprint: params.request_fingerprint,
          p_correlation_id: params.correlation_id,
          p_tool_id: params.tool_id,
          p_tool_version: params.tool_version,
          p_resource_kind: params.resource_kind,
          p_resource_id: params.resource_id,
          p_mode: params.mode,
          p_owner_token_hash: params.owner_token_hash,
          p_now: params.now,
          p_ttl_seconds: params.ttl_seconds,
        });

        if (error) {
          throwSafe(classifyIdempotencyRpcError(error, "claim"));
        }
        if (data === null || data === undefined) {
          throwSafe("IDEMPOTENCY_UNAVAILABLE");
        }
        return mapClaimPayload(data);
      } catch (err) {
        if (err instanceof IdempotencyError) {
          throw err;
        }
        if (isTransportFailure(err)) {
          throwSafe("IDEMPOTENCY_UNAVAILABLE");
        }
        throwSafe("IDEMPOTENCY_CLAIM_FAILED");
      }
    },

    async complete(
      params: IdempotencyRepositoryCompleteParams,
    ): Promise<void> {
      try {
        const { data, error } = await client.rpc(IDEMPOTENCY_RPC.complete, {
          p_record_id: params.record_id,
          p_owner_token_hash: params.owner_token_hash,
          p_terminal_result: params.terminal_result,
          p_terminal_result_hash: params.terminal_result_hash,
          p_completed_at: params.now,
        });

        if (error) {
          throwSafe(classifyIdempotencyRpcError(error, "complete"));
        }
        assertMutationOk(data);
      } catch (err) {
        if (err instanceof IdempotencyError) {
          throw err;
        }
        if (isTransportFailure(err)) {
          throwSafe("IDEMPOTENCY_UNAVAILABLE");
        }
        throwSafe("IDEMPOTENCY_COMPLETION_FAILED");
      }
    },

    async fail(params: IdempotencyRepositoryFailParams): Promise<void> {
      try {
        const { data, error } = await client.rpc(IDEMPOTENCY_RPC.fail, {
          p_record_id: params.record_id,
          p_owner_token_hash: params.owner_token_hash,
          p_terminal_result: params.terminal_result,
          p_terminal_result_hash: params.terminal_result_hash,
          p_failure_code: params.failure_code,
          p_completed_at: params.now,
        });

        if (error) {
          throwSafe(classifyIdempotencyRpcError(error, "fail"));
        }
        assertMutationOk(data);
      } catch (err) {
        if (err instanceof IdempotencyError) {
          throw err;
        }
        if (isTransportFailure(err)) {
          throwSafe("IDEMPOTENCY_UNAVAILABLE");
        }
        throwSafe("IDEMPOTENCY_COMPLETION_FAILED");
      }
    },
  };
}
