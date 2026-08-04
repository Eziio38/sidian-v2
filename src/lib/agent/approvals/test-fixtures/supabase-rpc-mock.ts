/**
 * Mock client Supabase RPC pour tests repository G1-H.
 * Surface minimale : rpc(fn, args) → PromiseLike<{ data, error }>.
 */

import {
  APPROVAL_RPC,
  type ApprovalPersistenceClient,
  type ApprovalPostgrestError,
  type ApprovalRpcResult,
} from "@/lib/agent/approvals";

export type RpcCall = {
  fn: string;
  args?: Record<string, unknown>;
};

export type MockRpcOutcome =
  | ApprovalRpcResult
  | { throw: unknown };

export type SpyApprovalRpcClient = ApprovalPersistenceClient & {
  calls: RpcCall[];
  callCount: () => number;
  reset: () => void;
  setNextOutcome: (outcome: MockRpcOutcome) => void;
  setOutcomeQueue: (outcomes: MockRpcOutcome[]) => void;
};

export function createSpyApprovalRpcClient(
  defaultOutcome: MockRpcOutcome = {
    data: {
      ok: true,
      approval_id: "11111111-1111-4111-8111-111111111111",
      status: "pending",
      requested_at: "2026-07-24T12:00:00.000Z",
      expires_at: "2026-07-24T13:00:00.000Z",
    },
    error: null,
  },
): SpyApprovalRpcClient {
  const calls: RpcCall[] = [];
  let queue: MockRpcOutcome[] = [];
  let fallback: MockRpcOutcome = defaultOutcome;

  const client: SpyApprovalRpcClient = {
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
        error: outcome.error as ApprovalPostgrestError | null,
      });
    },
  };

  return client;
}

export function sqlUnavailableError(): ApprovalPostgrestError {
  return {
    code: "08006",
    message:
      'duplicate key value violates unique constraint "agent_human_approvals_pkey" DETAIL: Key already exists.',
    details: "connection to server was lost",
    hint: "check network",
  };
}

export { APPROVAL_RPC };
