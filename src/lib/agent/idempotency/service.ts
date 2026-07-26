/**
 * Idempotency Service persistant fail-closed (G1-G).
 * Orchestration claim / complete / fail — aucune I/O directe (repository injecté).
 * Horloge et TTL injectées via l’entrée — jamais Date.now() implicite.
 */

import { randomBytes } from "node:crypto";

import { IdempotencyError } from "./errors";
import { hashOwnerToken, hashTerminalResult } from "./fingerprint";
import { resourceColumns, type IdempotencyRepository } from "./repository";
import {
  idempotencyClaimInputSchema,
  idempotencyCompleteInputSchema,
  idempotencyFailInputSchema,
  idempotencyTerminalResultSchema,
} from "./schemas";
import {
  createSupabaseIdempotencyRepository,
  type IdempotencyPersistenceClient,
} from "./supabase-idempotency-repository";
import type {
  IdempotencyClaimDecision,
  IdempotencyClaimInput,
  IdempotencyCompleteInput,
  IdempotencyFailInput,
  IdempotencyService,
  IdempotencyTerminalResult,
} from "./types";

function generateOwnerToken(): string {
  return randomBytes(32).toString("base64url");
}

function requireKey(raw: string): string {
  const key = raw.trim();
  if (!key) {
    throw new IdempotencyError("IDEMPOTENCY_KEY_REQUIRED");
  }
  return key;
}

function sanitizeTerminal(
  raw: IdempotencyTerminalResult,
): IdempotencyTerminalResult {
  const parsed = idempotencyTerminalResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new IdempotencyError("IDEMPOTENCY_INPUT_INVALID");
  }
  return parsed.data;
}

function mapClaimResult(
  ownerToken: string,
  result: Awaited<ReturnType<IdempotencyRepository["claim"]>>,
): IdempotencyClaimDecision {
  switch (result.sql_decision) {
    case "acquired":
      if (!result.record_id || !result.expires_at) {
        return { decision: "unavailable", code: "IDEMPOTENCY_UNAVAILABLE" };
      }
      return {
        decision: "acquired",
        owner_token: ownerToken,
        record_id: result.record_id,
        expires_at: result.expires_at,
      };
    case "expired_reacquired":
      if (!result.record_id || !result.expires_at) {
        return { decision: "unavailable", code: "IDEMPOTENCY_UNAVAILABLE" };
      }
      return {
        decision: "acquired",
        owner_token: ownerToken,
        record_id: result.record_id,
        expires_at: result.expires_at,
        reacquired: true,
      };
    case "replay_succeeded": {
      if (!result.terminal_result) {
        return { decision: "unavailable", code: "IDEMPOTENCY_UNAVAILABLE" };
      }
      const out: Extract<
        IdempotencyClaimDecision,
        { decision: "replay_success" }
      > = {
        decision: "replay_success",
        terminal_result: result.terminal_result,
      };
      if (result.record_id) out.record_id = result.record_id;
      if (result.terminal_result_hash) {
        out.terminal_result_hash = result.terminal_result_hash;
      }
      return out;
    }
    case "replay_failed": {
      if (!result.terminal_result) {
        return { decision: "unavailable", code: "IDEMPOTENCY_UNAVAILABLE" };
      }
      const out: Extract<
        IdempotencyClaimDecision,
        { decision: "replay_failure" }
      > = {
        decision: "replay_failure",
        terminal_result: result.terminal_result,
        code: "IDEMPOTENCY_REPLAY_FAILURE",
      };
      if (result.record_id) out.record_id = result.record_id;
      if (result.failure_code) out.failure_code = result.failure_code;
      if (result.terminal_result_hash) {
        out.terminal_result_hash = result.terminal_result_hash;
      }
      return out;
    }
    case "conflict":
      return { decision: "conflict", code: "IDEMPOTENCY_KEY_CONFLICT" };
    case "in_progress": {
      const out: Extract<
        IdempotencyClaimDecision,
        { decision: "in_progress" }
      > = {
        decision: "in_progress",
        code: "IDEMPOTENCY_IN_PROGRESS",
      };
      if (result.expires_at) out.expires_at = result.expires_at;
      return out;
    }
    default:
      return { decision: "unavailable", code: "IDEMPOTENCY_UNAVAILABLE" };
  }
}

/**
 * Crée le service d’idempotence.
 * @param repository Repository injecté (Supabase ou fake mémoire).
 */
export function createIdempotencyService(
  repository: IdempotencyRepository,
): IdempotencyService {
  return {
    async claim(input: IdempotencyClaimInput): Promise<IdempotencyClaimDecision> {
      const parsed = idempotencyClaimInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new IdempotencyError("IDEMPOTENCY_INPUT_INVALID");
      }

      const idempotencyKey = requireKey(parsed.data.idempotency_key);
      const ownerToken = generateOwnerToken();
      const ownerTokenHash = hashOwnerToken(ownerToken);
      const { resource_kind, resource_id } = resourceColumns(
        parsed.data.resource,
      );

      try {
        const result = await repository.claim({
          tenant_id: parsed.data.tenant_id,
          idempotency_key: idempotencyKey,
          correlation_id: parsed.data.correlation_id,
          tool_id: parsed.data.tool_id,
          tool_version: parsed.data.tool_version,
          mode: parsed.data.mode,
          resource_kind,
          resource_id,
          request_fingerprint: parsed.data.request_fingerprint,
          owner_token_hash: ownerTokenHash,
          now: parsed.data.now,
          ttl_seconds: parsed.data.ttl_seconds,
        });
        return mapClaimResult(ownerToken, result);
      } catch (err) {
        if (err instanceof IdempotencyError) {
          if (err.code === "IDEMPOTENCY_KEY_CONFLICT") {
            return {
              decision: "conflict",
              code: "IDEMPOTENCY_KEY_CONFLICT",
            };
          }
          if (err.code === "IDEMPOTENCY_IN_PROGRESS") {
            return {
              decision: "in_progress",
              code: "IDEMPOTENCY_IN_PROGRESS",
            };
          }
          if (err.code === "IDEMPOTENCY_KEY_REQUIRED") {
            throw err;
          }
          if (err.code === "IDEMPOTENCY_INPUT_INVALID") {
            throw err;
          }
          if (
            err.code === "IDEMPOTENCY_UNAVAILABLE" ||
            err.code === "IDEMPOTENCY_CLAIM_FAILED"
          ) {
            return {
              decision: "unavailable",
              code: "IDEMPOTENCY_UNAVAILABLE",
            };
          }
          throw err;
        }
        return {
          decision: "unavailable",
          code: "IDEMPOTENCY_UNAVAILABLE",
        };
      }
    },

    async complete(input: IdempotencyCompleteInput): Promise<void> {
      const parsed = idempotencyCompleteInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new IdempotencyError("IDEMPOTENCY_INPUT_INVALID");
      }

      const terminal = sanitizeTerminal(parsed.data.terminal_result);
      const terminalHash = hashTerminalResult(terminal);
      const ownerTokenHash = hashOwnerToken(parsed.data.owner_token);

      await repository.complete({
        record_id: parsed.data.record_id,
        owner_token_hash: ownerTokenHash,
        terminal_result: terminal,
        terminal_result_hash: terminalHash,
        now: parsed.data.now,
      });
    },

    async fail(input: IdempotencyFailInput): Promise<void> {
      const parsed = idempotencyFailInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new IdempotencyError("IDEMPOTENCY_INPUT_INVALID");
      }

      const ownerTokenHash = hashOwnerToken(parsed.data.owner_token);

      let terminal: IdempotencyTerminalResult;
      if (parsed.data.terminal_result !== undefined) {
        terminal = sanitizeTerminal(parsed.data.terminal_result);
      } else {
        terminal = {
          status: "failure",
          failure_code: parsed.data.failure_code,
        };
      }
      const terminalHash = hashTerminalResult(terminal);

      await repository.fail({
        record_id: parsed.data.record_id,
        owner_token_hash: ownerTokenHash,
        failure_code: parsed.data.failure_code,
        terminal_result: terminal,
        terminal_result_hash: terminalHash,
        now: parsed.data.now,
      });
    },
  };
}

/**
 * Raccourci production : client Supabase injecté → service prêt pour le Router.
 */
export function createSupabaseIdempotencyService(
  client: IdempotencyPersistenceClient,
): IdempotencyService {
  return createIdempotencyService(
    createSupabaseIdempotencyRepository(client),
  );
}
