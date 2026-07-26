/**
 * Exécuteur Tool Router pour `payment.create_attempt@1.0.0`.
 *
 * - Enqueue un job (async) puis tente un drain unique.
 * - Ne renvoie jamais `success` sur le seul sync Stripe : webhook = SoT.
 * - Fail-closed si checklist incomplète (plafond regle, SEPA, etc.).
 */

import type {
  ResolveToolExecutor,
  ToolExecutor,
  ToolExecutorInput,
} from "@/lib/agent/router/executor";
import { ToolExecutorError } from "@/lib/agent/router/executor";

import { buildPaymentJobIdempotencyKey } from "./idempotency";
import { isPaymentRuntimeError } from "./errors";
import type { PaymentRuntimeService } from "./service";
import type { PaymentCreateAttemptToolOutput } from "./types";

function toExecutorError(err: unknown): ToolExecutorError {
  if (isPaymentRuntimeError(err)) {
    return new ToolExecutorError({
      category: err.category,
      code: err.code,
      message: err.message,
      userMessage: err.userMessage,
    });
  }
  return new ToolExecutorError({
    category: "technical",
    code: "PROVIDER_UNAVAILABLE",
    message: "payment_runtime_executor_failed",
    userMessage: "Le runtime de paiement est indisponible.",
  });
}

function mapDrainToToolOutput(
  drain: NonNullable<Awaited<ReturnType<PaymentRuntimeService["drain"]>>>,
): PaymentCreateAttemptToolOutput {
  if (drain.status === "pending") {
    return {
      status: "pending",
      payment_attempt_id: drain.payment_attempt_id,
      provider_status: drain.provider_status,
      external_reference: drain.external_reference,
    };
  }
  if (drain.status === "unknown") {
    return {
      status: "unknown",
      payment_attempt_id: drain.payment_attempt_id,
      provider_status: drain.code,
      external_reference: drain.external_reference,
    };
  }
  if (drain.status === "skipped_in_progress") {
    return {
      status: "pending",
      payment_attempt_id: drain.jobId,
      provider_status: "in_progress",
    };
  }
  return {
    status: "failure",
    payment_attempt_id: drain.payment_attempt_id,
    provider_status: drain.code,
  };
}

export function createPaymentCreateAttemptExecutor(
  runtime: PaymentRuntimeService,
): ToolExecutor {
  return {
    async execute(input: ToolExecutorInput): Promise<PaymentCreateAttemptToolOutput> {
      try {
        runtime.assertNotInboundWebhook({
          caller: "agent_tool:payment.create_attempt",
        });

        const args = input.arguments as {
          invoice_id: string;
          amount_cents: number;
          currency: "EUR";
        };

        // Contrat outil : invoice_id = créance (paiement à recevoir) V2.
        const creanceId = args.invoice_id;
        const attemptVersion = [
          input.correlation_id,
          String(args.amount_cents),
        ].join(":");

        const idempotencyKey = buildPaymentJobIdempotencyKey({
          creanceId,
          amountCents: args.amount_cents,
          currency: args.currency,
          attemptVersion,
          source: "agent_tool",
        });

        const job = await runtime.enqueue({
          prestataireId: input.tenant.tenant_id,
          creanceId,
          amountCents: args.amount_cents,
          currency: args.currency,
          source: "agent_tool",
          idempotencyKey,
          correlationId: input.correlation_id,
        });

        const drain = await runtime.drain({ jobId: job.id });
        if (!drain) {
          return {
            status: "pending",
            payment_attempt_id: job.id,
            provider_status: "queued",
          };
        }
        return mapDrainToToolOutput(drain);
      } catch (err) {
        throw toExecutorError(err);
      }
    },
  };
}

export function createPaymentRuntimeExecutors(
  runtime: PaymentRuntimeService,
): ResolveToolExecutor {
  const executor = createPaymentCreateAttemptExecutor(runtime);
  return (toolId, version) => {
    if (toolId === "payment.create_attempt" && version === "1.0.0") {
      return executor;
    }
    return undefined;
  };
}
