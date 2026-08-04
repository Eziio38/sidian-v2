/**
 * Observabilité drain — best-effort, sans PII / secrets / payloads.
 */

import { createHash } from "node:crypto";

import type {
  DrainBatchResult,
  DrainItemOutcome,
  DrainKind,
  DrainObservabilityEvent,
  DrainObservabilitySink,
} from "./types";

export function hashIdempotencyKey(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function createNullDrainObservabilitySink(): DrainObservabilitySink {
  return {
    async record() {
      /* no-op */
    },
  };
}

export function createMemoryDrainObservabilitySink(): DrainObservabilitySink & {
  events: DrainObservabilityEvent[];
} {
  const events: DrainObservabilityEvent[] = [];
  return {
    events,
    async record(event) {
      events.push(event);
    },
  };
}

export async function emitDrainItem(params: {
  sink: DrainObservabilitySink;
  kind: DrainKind;
  occurredAt: string;
  itemId: string;
  outcome: DrainItemOutcome;
  idempotencyKey?: string;
  errorCode?: string;
}): Promise<void> {
  const event: DrainObservabilityEvent = {
    schemaVersion: "1",
    kind: params.kind,
    occurredAt: params.occurredAt,
    outcome: params.outcome,
    itemId: params.itemId,
    idempotencyKeyHash: params.idempotencyKey
      ? hashIdempotencyKey(params.idempotencyKey)
      : undefined,
    errorCode: params.errorCode,
  };
  try {
    await params.sink.record(event);
  } catch {
    // best-effort
  }
}

export async function emitDrainBatchComplete(params: {
  sink: DrainObservabilitySink;
  result: DrainBatchResult;
}): Promise<void> {
  const { result } = params;
  const event: DrainObservabilityEvent = {
    schemaVersion: "1",
    kind: result.kind,
    occurredAt: result.ranAt,
    outcome: "batch_complete",
    claimed: result.claimed,
    delivered: result.delivered,
    retryable: result.retryable,
    deadLetter: result.deadLetter,
    durationMs: result.durationMs,
  };
  try {
    await params.sink.record(event);
  } catch {
    // best-effort
  }
}

export function emptyBatchResult(
  kind: DrainKind,
  ranAt: string,
  durationMs = 0,
): DrainBatchResult {
  return {
    kind,
    claimed: 0,
    delivered: 0,
    retryable: 0,
    deadLetter: 0,
    skipped: 0,
    leaseLost: 0,
    errors: 0,
    durationMs,
    ranAt,
  };
}
