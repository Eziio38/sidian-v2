/**
 * Spy IdempotencyService mémoire pour tests Router G1-G.
 */

import {
  createIdempotencyService,
  type IdempotencyClaimDecision,
  type IdempotencyClaimInput,
  type IdempotencyCompleteInput,
  type IdempotencyFailInput,
  type IdempotencyService,
} from "@/lib/agent/idempotency";
import {
  createMemoryIdempotencyRepository,
  type MemoryIdempotencyRepository,
} from "@/lib/agent/idempotency/test-fixtures";

export type SpyIdempotencyService = IdempotencyService & {
  repository: MemoryIdempotencyRepository;
  claimCalls: IdempotencyClaimInput[];
  completeCalls: IdempotencyCompleteInput[];
  failCalls: IdempotencyFailInput[];
  claimCount: () => number;
  completeCount: () => number;
  failCount: () => number;
  reset: () => void;
};

/**
 * Service réel sur repository mémoire — sémantique claim/complete/fail fidèle.
 */
export function createSpyIdempotencyService(): SpyIdempotencyService {
  const repository = createMemoryIdempotencyRepository();
  const inner = createIdempotencyService(repository);
  const claimCalls: IdempotencyClaimInput[] = [];
  const completeCalls: IdempotencyCompleteInput[] = [];
  const failCalls: IdempotencyFailInput[] = [];

  return {
    repository,
    claimCalls,
    completeCalls,
    failCalls,
    claimCount: () => claimCalls.length,
    completeCount: () => completeCalls.length,
    failCount: () => failCalls.length,
    reset: () => {
      repository.reset();
      claimCalls.length = 0;
      completeCalls.length = 0;
      failCalls.length = 0;
    },
    async claim(input: IdempotencyClaimInput): Promise<IdempotencyClaimDecision> {
      claimCalls.push(input);
      return inner.claim(input);
    },
    async complete(input: IdempotencyCompleteInput): Promise<void> {
      completeCalls.push(input);
      return inner.complete(input);
    },
    async fail(input: IdempotencyFailInput): Promise<void> {
      failCalls.push(input);
      return inner.fail(input);
    },
  };
}

/**
 * Service entièrement contrôlé (décisions / erreurs injectées).
 */
export function createControlledIdempotencyService(options: {
  claim?:
    | IdempotencyClaimDecision
    | ((input: IdempotencyClaimInput) => Promise<IdempotencyClaimDecision>);
  completeError?: unknown;
  failError?: unknown;
}): SpyIdempotencyService {
  const repository = createMemoryIdempotencyRepository();
  const claimCalls: IdempotencyClaimInput[] = [];
  const completeCalls: IdempotencyCompleteInput[] = [];
  const failCalls: IdempotencyFailInput[] = [];
  const defaultAcquired: IdempotencyClaimDecision = {
    decision: "acquired",
    owner_token: "owner_token_test_controlled",
    record_id: "c1111111-1111-4111-8111-111111111111",
    expires_at: "2026-07-24T12:02:00.000Z",
  };

  return {
    repository,
    claimCalls,
    completeCalls,
    failCalls,
    claimCount: () => claimCalls.length,
    completeCount: () => completeCalls.length,
    failCount: () => failCalls.length,
    reset: () => {
      claimCalls.length = 0;
      completeCalls.length = 0;
      failCalls.length = 0;
    },
    async claim(input: IdempotencyClaimInput): Promise<IdempotencyClaimDecision> {
      claimCalls.push(input);
      if (typeof options.claim === "function") {
        return options.claim(input);
      }
      return options.claim ?? defaultAcquired;
    },
    async complete(input: IdempotencyCompleteInput): Promise<void> {
      completeCalls.push(input);
      if (options.completeError !== undefined) {
        throw options.completeError;
      }
    },
    async fail(input: IdempotencyFailInput): Promise<void> {
      failCalls.push(input);
      if (options.failError !== undefined) {
        throw options.failError;
      }
    },
  };
}
