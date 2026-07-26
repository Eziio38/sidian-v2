/**
 * Drain WhatsApp outbox — réutilise processOutboundMessage + claim SQL.
 */

import {
  processOutboundMessage,
  type ProcessOutboundResult,
} from "../../../communication-channels/outbound/processor";
import type { CommunicationMessageRepository } from "../../../communication-channels/outbound/types";
import type { WhatsAppEnv } from "../../../communication-channels/whatsapp/env";
import type { WhatsAppTransport } from "../../../communication-channels/whatsapp/transport";
import {
  DEFAULT_DRAIN_BATCH_LIMIT,
  DEFAULT_DRAIN_LEASE_SECONDS,
  type DrainBatchResult,
  type DrainObservabilitySink,
  type DrainRunOptions,
  type OutboxDrain,
} from "../types";
import {
  createNullDrainObservabilitySink,
  emitDrainBatchComplete,
  emitDrainItem,
  emptyBatchResult,
} from "../observability";

export type WhatsAppOutboxDrainDeps = {
  messages: CommunicationMessageRepository;
  env: WhatsAppEnv;
  transport?: WhatsAppTransport;
  sink?: DrainObservabilitySink;
  defaultLimit?: number;
  defaultLeaseSeconds?: number;
};

function mapProcessResult(
  result: ProcessOutboundResult,
): {
  outcome: "delivered" | "retryable" | "dead_letter" | "skipped";
  errorCode?: string;
} {
  if (result.outcome === "accepted") {
    return { outcome: "delivered" };
  }
  if (result.outcome === "skipped") {
    return { outcome: "skipped", errorCode: result.reason };
  }
  if (result.retryable) {
    return {
      outcome: "retryable",
      errorCode: result.message.lastErrorCode ?? undefined,
    };
  }
  return {
    outcome: "dead_letter",
    errorCode: result.message.lastErrorCode ?? undefined,
  };
}

export function createWhatsAppOutboxDrain(
  deps: WhatsAppOutboxDrainDeps,
): OutboxDrain {
  const sink = deps.sink ?? createNullDrainObservabilitySink();
  const defaultLimit = deps.defaultLimit ?? DEFAULT_DRAIN_BATCH_LIMIT;
  const defaultLeaseSeconds =
    deps.defaultLeaseSeconds ?? DEFAULT_DRAIN_LEASE_SECONDS;

  return {
    kind: "whatsapp_outbound",
    async run(options: DrainRunOptions = {}): Promise<DrainBatchResult> {
      const nowFn = options.now ?? (() => new Date());
      const started = nowFn();
      const ranAt = started.toISOString();
      const limit = options.limit ?? defaultLimit;
      const leaseSeconds = options.leaseSeconds ?? defaultLeaseSeconds;

      if (deps.env.mode === "disabled") {
        return emptyBatchResult("whatsapp_outbound", ranAt);
      }

      const claimed = await deps.messages.claimQueuedBatch({
        limit,
        leaseSeconds,
      });

      const result: DrainBatchResult = {
        ...emptyBatchResult("whatsapp_outbound", ranAt),
        claimed: claimed.length,
      };

      for (const message of claimed) {
        try {
          const processed = await processOutboundMessage({
            messageId: message.id,
            messages: deps.messages,
            env: deps.env,
            transport: deps.transport,
            alreadyClaimed: message,
          });
          const mapped = mapProcessResult(processed);
          await emitDrainItem({
            sink,
            kind: "whatsapp_outbound",
            occurredAt: nowFn().toISOString(),
            itemId: message.id,
            outcome: mapped.outcome,
            idempotencyKey: message.idempotencyKey,
            errorCode: mapped.errorCode,
          });
          if (mapped.outcome === "delivered") result.delivered += 1;
          else if (mapped.outcome === "retryable") result.retryable += 1;
          else if (mapped.outcome === "dead_letter") result.deadLetter += 1;
          else result.skipped += 1;
        } catch (error) {
          const messageText =
            error instanceof Error ? error.message : "unknown";
          if (messageText.includes("lease_lost")) {
            result.leaseLost += 1;
            await emitDrainItem({
              sink,
              kind: "whatsapp_outbound",
              occurredAt: nowFn().toISOString(),
              itemId: message.id,
              outcome: "lease_lost",
              idempotencyKey: message.idempotencyKey,
              errorCode: "lease_lost",
            });
          } else {
            result.errors += 1;
          }
        }
      }

      result.durationMs = Math.max(0, nowFn().getTime() - started.getTime());
      result.ranAt = nowFn().toISOString();
      await emitDrainBatchComplete({ sink, result });
      return result;
    },
  };
}
