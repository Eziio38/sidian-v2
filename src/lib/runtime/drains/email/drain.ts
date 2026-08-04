/**
 * Drain Email — réutilise processQueuedEmailBatch du module Email (SOUS-AGENT A).
 * Live : repository Supabase uniquement (jamais mémoire).
 */

import {
  processQueuedEmailBatch,
  type ProcessEmailResult,
} from "../../../email/outbox/processor";
import type { EmailOutboxRepository } from "../../../email/outbox/repository";
import type { EmailEnv } from "../../../email/env";
import type { EmailProvider } from "../../../email/provider";
import {
  createNullDrainObservabilitySink,
  emitDrainBatchComplete,
  emitDrainItem,
  emptyBatchResult,
} from "../observability";
import {
  DEFAULT_DRAIN_BATCH_LIMIT,
  type DrainBatchResult,
  type DrainObservabilitySink,
  type DrainRunOptions,
  type OutboxDrain,
} from "../types";

export type EmailOutboxDrainDeps = {
  outbox: EmailOutboxRepository;
  env: EmailEnv;
  provider?: EmailProvider;
  sink?: DrainObservabilitySink;
  defaultLimit?: number;
};

function mapEmailResult(result: ProcessEmailResult): {
  outcome: "delivered" | "retryable" | "dead_letter" | "skipped";
  id?: string;
  idempotencyKey?: string;
  errorCode?: string;
} {
  if (result.outcome === "sent") {
    return {
      outcome: "delivered",
      id: result.record.id,
      idempotencyKey: result.record.idempotencyKey,
    };
  }
  if (result.outcome === "dead_letter") {
    return {
      outcome: "dead_letter",
      id: result.record.id,
      idempotencyKey: result.record.idempotencyKey,
      errorCode: result.record.lastErrorCode ?? undefined,
    };
  }
  if (result.outcome === "skipped") {
    return { outcome: "skipped", errorCode: result.reason };
  }
  if (result.retryable) {
    return {
      outcome: "retryable",
      id: result.record.id,
      idempotencyKey: result.record.idempotencyKey,
      errorCode: result.record.lastErrorCode ?? undefined,
    };
  }
  return {
    outcome: "dead_letter",
    id: result.record.id,
    idempotencyKey: result.record.idempotencyKey,
    errorCode: result.record.lastErrorCode ?? undefined,
  };
}

export function createEmailOutboxDrain(deps: EmailOutboxDrainDeps): OutboxDrain {
  const sink = deps.sink ?? createNullDrainObservabilitySink();
  const defaultLimit = deps.defaultLimit ?? DEFAULT_DRAIN_BATCH_LIMIT;

  return {
    kind: "email_outbound",
    async run(options: DrainRunOptions = {}): Promise<DrainBatchResult> {
      const nowFn = options.now ?? (() => new Date());
      const started = nowFn();
      const limit = options.limit ?? defaultLimit;

      if (deps.env.mode === "disabled") {
        return emptyBatchResult("email_outbound", started.toISOString());
      }

      const processed = await processQueuedEmailBatch({
        outbox: deps.outbox,
        env: deps.env,
        provider: deps.provider,
        limit,
      });

      const result: DrainBatchResult = {
        ...emptyBatchResult("email_outbound", started.toISOString()),
        claimed: processed.length,
      };

      for (const item of processed) {
        const mapped = mapEmailResult(item);
        if (mapped.id) {
          await emitDrainItem({
            sink,
            kind: "email_outbound",
            occurredAt: nowFn().toISOString(),
            itemId: mapped.id,
            outcome: mapped.outcome,
            idempotencyKey: mapped.idempotencyKey,
            errorCode: mapped.errorCode,
          });
        }
        if (mapped.outcome === "delivered") result.delivered += 1;
        else if (mapped.outcome === "retryable") result.retryable += 1;
        else if (mapped.outcome === "dead_letter") result.deadLetter += 1;
        else result.skipped += 1;
      }

      result.durationMs = Math.max(0, nowFn().getTime() - started.getTime());
      result.ranAt = nowFn().toISOString();
      await emitDrainBatchComplete({ sink, result });
      return result;
    },
  };
}
