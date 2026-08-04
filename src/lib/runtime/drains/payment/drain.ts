/**
 * Drain payment — stripe_connect_audit_outbox (seul outbox paiement MVP).
 * Les tentatives de paiement restent event-driven (webhooks) ; ce drain
 * livre l’audit Connect durable vers audit_log.
 */

import {
  createNullDrainObservabilitySink,
  emitDrainBatchComplete,
  emptyBatchResult,
} from "../observability";
import {
  DEFAULT_DRAIN_BATCH_LIMIT,
  type DrainBatchResult,
  type DrainObservabilitySink,
  type DrainRunOptions,
  type OutboxDrain,
} from "../types";

export type PaymentConnectAuditDrainClient = {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
};

export type PaymentConnectAuditDrainDeps = {
  client: PaymentConnectAuditDrainClient;
  sink?: DrainObservabilitySink;
  defaultLimit?: number;
};

export function createPaymentConnectAuditOutboxDrain(
  deps: PaymentConnectAuditDrainDeps,
): OutboxDrain {
  const sink = deps.sink ?? createNullDrainObservabilitySink();
  const defaultLimit = deps.defaultLimit ?? DEFAULT_DRAIN_BATCH_LIMIT;

  return {
    kind: "payment_connect_audit",
    async run(options: DrainRunOptions = {}): Promise<DrainBatchResult> {
      const nowFn = options.now ?? (() => new Date());
      const started = nowFn();
      const limit = options.limit ?? defaultLimit;

      const result = emptyBatchResult(
        "payment_connect_audit",
        started.toISOString(),
      );

      const rpcResult = await deps.client.rpc(
        "drain_stripe_connect_audit_outbox_batch",
        { p_limit: limit },
      );

      if (rpcResult.error) {
        result.errors = 1;
        result.durationMs = Math.max(0, nowFn().getTime() - started.getTime());
        result.ranAt = nowFn().toISOString();
        await emitDrainBatchComplete({ sink, result });
        return result;
      }

      const delivered =
        typeof rpcResult.data === "number"
          ? rpcResult.data
          : Number(rpcResult.data ?? 0);

      result.claimed = delivered;
      result.delivered = delivered;
      result.durationMs = Math.max(0, nowFn().getTime() - started.getTime());
      result.ranAt = nowFn().toISOString();
      await emitDrainBatchComplete({ sink, result });
      return result;
    },
  };
}
