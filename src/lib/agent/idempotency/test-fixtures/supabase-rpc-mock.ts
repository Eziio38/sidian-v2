/**
 * Mock client Supabase RPC pour tests repository G1-G.
 * Surface minimale : rpc(fn, args) → PromiseLike<{ data, error }>.
 */

import {
  IDEMPOTENCY_RPC,
  type IdempotencyPersistenceClient,
  type IdempotencyPostgrestError,
  type IdempotencyRpcResult,
} from "@/lib/agent/idempotency";

export type RpcCall = {
  fn: string;
  args?: Record<string, unknown>;
};

export type MockRpcOutcome =
  | IdempotencyRpcResult
  | { throw: unknown };

export type SpyIdempotencyRpcClient = IdempotencyPersistenceClient & {
  calls: RpcCall[];
  callCount: () => number;
  reset: () => void;
  setNextOutcome: (outcome: MockRpcOutcome) => void;
  setOutcomeQueue: (outcomes: MockRpcOutcome[]) => void;
};

export function createSpyIdempotencyRpcClient(
  defaultOutcome: MockRpcOutcome = {
    data: {
      decision: "acquired",
      record_id: "11111111-1111-4111-8111-111111111111",
      expires_at: "2026-07-24T12:02:00.000Z",
    },
    error: null,
  },
): SpyIdempotencyRpcClient {
  const calls: RpcCall[] = [];
  let queue: MockRpcOutcome[] = [];
  let fallback: MockRpcOutcome = defaultOutcome;

  const client: SpyIdempotencyRpcClient = {
    calls,
    callCount: () => calls.length,
    reset() {
      calls.length = 0;
      queue = [];
      fallback = defaultOutcome;
    },
    setNextOutcome(outcome) {
      queue.push(outcome);
    },
    setOutcomeQueue(outcomes) {
      queue = [...outcomes];
    },
    rpc(fn, args) {
      calls.push({ fn, args });
      const outcome = queue.length > 0 ? queue.shift()! : fallback;

      if ("throw" in outcome) {
        return Promise.reject(outcome.throw);
      }
      return Promise.resolve({
        data: outcome.data,
        error: outcome.error as IdempotencyPostgrestError | null,
      });
    },
  };

  return client;
}

export function sqlUnavailableError(): IdempotencyPostgrestError {
  return {
    code: "08006",
    message:
      'duplicate key value violates unique constraint "agent_idempotency_records_tenant_key_uq" DETAIL: Key already exists.',
    details: "connection to server was lost",
    hint: "check network",
  };
}

export { IDEMPOTENCY_RPC };
