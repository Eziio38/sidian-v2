/**
 * Scanner de paiements automatiques (03 §7) — enqueue uniquement.
 * Ne crée jamais de PaymentIntent ; l'exécuteur draine la file.
 */

import { buildPaymentJobIdempotencyKey } from "./idempotency";
import type { PaymentRuntimeService } from "./service";
import type { PaymentJob } from "./types";

export type AutomaticPaymentCandidate = {
  prestataireId: string;
  creanceId: string;
  remainingCents: number;
  /** Version d'essai stable (ex. date d'échéance ISO date) pour l'idempotence. */
  attemptVersion: string;
};

export type ScanAutomaticPaymentsResult = {
  enqueued: PaymentJob[];
  skipped: Array<{ creanceId: string; reason: string }>;
};

/**
 * Pour chaque créance candidate, enqueue un job idempotent.
 * Aucun appel Stripe ici.
 */
export async function enqueueAutomaticPaymentCandidates(params: {
  runtime: PaymentRuntimeService;
  candidates: AutomaticPaymentCandidate[];
  correlationId?: string;
}): Promise<ScanAutomaticPaymentsResult> {
  params.runtime.assertNotInboundWebhook({ caller: "payment_scanner" });

  const enqueued: PaymentJob[] = [];
  const skipped: Array<{ creanceId: string; reason: string }> = [];

  for (const candidate of params.candidates) {
    if (
      !Number.isSafeInteger(candidate.remainingCents) ||
      candidate.remainingCents <= 0
    ) {
      skipped.push({
        creanceId: candidate.creanceId,
        reason: "non_positive_remaining",
      });
      continue;
    }

    const idempotencyKey = buildPaymentJobIdempotencyKey({
      creanceId: candidate.creanceId,
      amountCents: candidate.remainingCents,
      currency: "EUR",
      attemptVersion: candidate.attemptVersion,
      source: "scanner",
    });

    try {
      const job = await params.runtime.enqueue({
        prestataireId: candidate.prestataireId,
        creanceId: candidate.creanceId,
        amountCents: candidate.remainingCents,
        currency: "EUR",
        source: "scanner",
        idempotencyKey,
        correlationId: params.correlationId ?? null,
      });
      enqueued.push(job);
    } catch (error) {
      skipped.push({
        creanceId: candidate.creanceId,
        reason: error instanceof Error ? error.message : "enqueue_failed",
      });
    }
  }

  return { enqueued, skipped };
}
