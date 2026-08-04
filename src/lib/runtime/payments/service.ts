import {
  AUTOMATIC_EXECUTION_GUARD_VERSION,
  PAYMENT_JOB_LEASE_SECONDS,
} from "./constants";
import { evaluateAutomaticPaymentChecklist } from "./checklist";
import { PaymentRuntimeError, isPaymentRuntimeError } from "./errors";
import { buildOffSessionStripeIdempotencyKey } from "./idempotency";
import type {
  PaymentAttemptRepository,
  PaymentJobRepository,
} from "./repository";
import { createOffSessionCardPaymentIntent } from "./stripe-off-session";
import type {
  DrainJobResult,
  OffSessionProviderOutcome,
  PaymentJob,
} from "./types";

export type PaymentExecutorDeps = {
  jobs: PaymentJobRepository;
  attempts: PaymentAttemptRepository;
  paymentsEnabled: boolean;
  createPaymentIntent?: typeof createOffSessionCardPaymentIntent;
  leaseSeconds?: number;
  applicationFeeAmount?: number;
};

export type PaymentRuntimeService = {
  /** Scanner / agent : enqueue uniquement — jamais de débit direct. */
  enqueue(input: {
    prestataireId: string;
    creanceId: string;
    amountCents: number;
    currency: "EUR";
    source: "scanner" | "agent_tool";
    idempotencyKey: string;
    correlationId?: string | null;
  }): Promise<PaymentJob>;

  /** Draine un job (par id ou prochain pending). */
  drain(params?: { jobId?: string }): Promise<DrainJobResult | null>;

  /**
   * Garde explicite : un webhook entrant ne doit jamais appeler drain/enqueue
   * pour déclencher un débit. Utilisé comme assertion documentaire + runtime.
   */
  assertNotInboundWebhook(context: { caller: string }): void;
};

function mapProviderToDrain(
  jobId: string,
  tentativeId: string | undefined,
  outcome: OffSessionProviderOutcome,
): DrainJobResult {
  if (outcome.kind === "created") {
    return {
      status: "pending",
      jobId,
      payment_attempt_id: tentativeId!,
      provider_status: outcome.providerStatus,
      external_reference: outcome.paymentIntentId,
    };
  }
  if (outcome.kind === "temporary_failure") {
    return {
      status: "failure",
      jobId,
      code: "PROVIDER_TEMPORARY_FAILURE",
      provider_status: outcome.code,
      payment_attempt_id: tentativeId,
    };
  }
  if (outcome.kind === "permanent_failure") {
    return {
      status: "failure",
      jobId,
      code: "PROVIDER_PERMANENT_FAILURE",
      provider_status: outcome.code,
      payment_attempt_id: tentativeId,
    };
  }
  return {
    status: "unknown",
    jobId,
    code: "UNKNOWN_PROVIDER_RESULT",
    payment_attempt_id: tentativeId,
    external_reference: undefined,
  };
}

export function createPaymentRuntimeService(
  deps: PaymentExecutorDeps,
): PaymentRuntimeService {
  const leaseSeconds = deps.leaseSeconds ?? PAYMENT_JOB_LEASE_SECONDS;
  const createPi =
    deps.createPaymentIntent ?? createOffSessionCardPaymentIntent;
  const fee = deps.applicationFeeAmount ?? 0;

  return {
    assertNotInboundWebhook(context) {
      if (
        context.caller.includes("webhook") ||
        context.caller.includes("inbound")
      ) {
        throw new PaymentRuntimeError({
          code: "INBOUND_WEBHOOK_MUST_NOT_DEBIT",
          category: "technical",
          message: "inbound_webhook_must_not_trigger_debit",
        });
      }
    },

    async enqueue(input) {
      if (!deps.paymentsEnabled) {
        throw new PaymentRuntimeError({
          code: "PAYMENTS_DISABLED",
          category: "business",
          message: "payments_disabled",
        });
      }
      return deps.jobs.enqueue({
        ...input,
        correlationId: input.correlationId ?? null,
      });
    },

    async drain(params = {}) {
      const claim = params.jobId
        ? await deps.jobs.claimById({
            jobId: params.jobId,
            leaseSeconds,
          })
        : await deps.jobs.claimNext({ leaseSeconds });

      if (claim.status === "not_found") return null;
      if (claim.status === "in_progress") {
        return { status: "skipped_in_progress", jobId: claim.job.id };
      }
      if (claim.status === "already_terminal") {
        if (claim.job.status === "succeeded_pending_webhook") {
          return {
            status: "pending",
            jobId: claim.job.id,
            payment_attempt_id: claim.job.tentativePaiementId ?? claim.job.id,
            provider_status: "awaiting_webhook",
            external_reference: claim.job.stripePaymentIntentId ?? undefined,
          };
        }
        return {
          status: "failure",
          jobId: claim.job.id,
          code: claim.job.failureCode ?? "CHECKLIST_INCOMPLETE",
          payment_attempt_id: claim.job.tentativePaiementId ?? undefined,
        };
      }

      const { job, leaseToken } = claim;
      let tentativeId: string | undefined;

      try {
        if (!deps.paymentsEnabled) {
          await deps.jobs.complete({
            jobId: job.id,
            leaseToken,
            outcome: {
              kind: "failed_terminal",
              failureCode: "PAYMENTS_DISABLED",
            },
          });
          return {
            status: "failure",
            jobId: job.id,
            code: "PAYMENTS_DISABLED",
          };
        }

        const snapshot = await deps.attempts.loadChecklistSnapshot({
          creanceId: job.creanceId,
          prestataireId: job.prestataireId,
          requestedAmountCents: job.amountCents,
          requestedCurrency: job.currency,
          paymentsEnabled: deps.paymentsEnabled,
        });

        // Force la version de garde runtime (jamais trust client).
        snapshot.guardVersion = AUTOMATIC_EXECUTION_GUARD_VERSION;

        const checklist = evaluateAutomaticPaymentChecklist(snapshot);
        if (!checklist.ok) {
          await deps.jobs.complete({
            jobId: job.id,
            leaseToken,
            outcome: {
              kind: "failed_terminal",
              failureCode: checklist.code,
            },
          });
          return {
            status: "failure",
            jobId: job.id,
            code: checklist.code,
            provider_status: checklist.detail,
          };
        }

        const stripeIdempotencyKey = buildOffSessionStripeIdempotencyKey({
          creanceId: job.creanceId,
          amountCents: checklist.amountCents,
          currency: job.currency,
          authorizationId: checklist.authorizationId,
          attemptVersion: job.idempotencyKey,
        });

        const claimAttempt = await deps.attempts.claimAutomaticAttempt({
          creanceId: job.creanceId,
          prestataireId: job.prestataireId,
          amountCents: checklist.amountCents,
          authorizationId: checklist.authorizationId,
          stripeAccountId: checklist.stripeAccountId,
          stripeCustomerId: checklist.stripeCustomerId,
          stripePaymentMethodId: checklist.stripePaymentMethodId,
          idempotencyKey: stripeIdempotencyKey,
          leaseSeconds,
        });

        if (claimAttempt.status === "rejected") {
          await deps.jobs.complete({
            jobId: job.id,
            leaseToken,
            outcome: {
              kind: "failed_terminal",
              failureCode: String(claimAttempt.code),
            },
          });
          return {
            status: "failure",
            jobId: job.id,
            code: String(claimAttempt.code),
          };
        }

        if (claimAttempt.status === "in_progress") {
          await deps.jobs.complete({
            jobId: job.id,
            leaseToken,
            outcome: {
              kind: "failed_retryable",
              failureCode: "JOB_IN_PROGRESS",
            },
          });
          return {
            status: "skipped_in_progress",
            jobId: job.id,
          };
        }

        if (claimAttempt.status === "already_created") {
          // PI déjà lié : ne pas re-débiter ; webhook reste SoT.
          await deps.jobs.complete({
            jobId: job.id,
            leaseToken,
            outcome: {
              kind: "succeeded_pending_webhook",
              tentativePaiementId: claimAttempt.tentativeId,
              stripePaymentIntentId: claimAttempt.stripePaymentIntentId,
            },
          });
          return {
            status: "pending",
            jobId: job.id,
            payment_attempt_id: claimAttempt.tentativeId,
            provider_status: "awaiting_webhook",
            external_reference: claimAttempt.stripePaymentIntentId,
          };
        }

        tentativeId = claimAttempt.tentativeId;

        const provider = await createPi({
          stripeAccountId: claimAttempt.stripeAccountId,
          stripeCustomerId: claimAttempt.stripeCustomerId,
          stripePaymentMethodId: claimAttempt.stripePaymentMethodId,
          amountCents: claimAttempt.montant,
          creanceId: job.creanceId,
          tentativeId: claimAttempt.tentativeId,
          authorizationId: claimAttempt.authorizationId,
          applicationFeeAmount: fee,
          idempotencyKey: claimAttempt.idempotencyKey,
        });

        if (provider.kind === "created") {
          const localEtat = provider.requiresAction
            ? "NECESSITE_ACTION_CLIENT"
            : provider.providerStatus === "processing"
              ? "EN_TRAITEMENT"
              : "CREEE";
          // Même si Stripe renvoie `succeeded` en sync, on ne pose pas RÉUSSIE :
          // le webhook payment_intent.succeeded est la source de vérité.
          await deps.attempts.completeAutomaticAttempt({
            tentativeId: claimAttempt.tentativeId,
            leaseToken: claimAttempt.leaseToken,
            stripePaymentIntentId: provider.paymentIntentId,
            stripeAccountId: claimAttempt.stripeAccountId,
            stripeCustomerId: claimAttempt.stripeCustomerId,
            applicationFeeAmount: fee,
            localEtat,
          });
          await deps.jobs.complete({
            jobId: job.id,
            leaseToken,
            outcome: {
              kind: "succeeded_pending_webhook",
              tentativePaiementId: claimAttempt.tentativeId,
              stripePaymentIntentId: provider.paymentIntentId,
            },
          });
          return mapProviderToDrain(job.id, claimAttempt.tentativeId, provider);
        }

        if (provider.kind === "temporary_failure") {
          await deps.attempts.failAutomaticAttempt({
            tentativeId: claimAttempt.tentativeId,
            leaseToken: claimAttempt.leaseToken,
            retryable: true,
            errorCode: provider.code,
          });
          await deps.jobs.complete({
            jobId: job.id,
            leaseToken,
            outcome: {
              kind: "failed_retryable",
              failureCode: "PROVIDER_TEMPORARY_FAILURE",
              tentativePaiementId: claimAttempt.tentativeId,
            },
          });
          return mapProviderToDrain(job.id, claimAttempt.tentativeId, provider);
        }

        if (provider.kind === "permanent_failure") {
          await deps.attempts.failAutomaticAttempt({
            tentativeId: claimAttempt.tentativeId,
            leaseToken: claimAttempt.leaseToken,
            retryable: false,
            errorCode: provider.code,
          });
          await deps.jobs.complete({
            jobId: job.id,
            leaseToken,
            outcome: {
              kind: "failed_terminal",
              failureCode: "PROVIDER_PERMANENT_FAILURE",
              tentativePaiementId: claimAttempt.tentativeId,
            },
          });
          return mapProviderToDrain(job.id, claimAttempt.tentativeId, provider);
        }

        // unknown — ne pas annuler agressivement ; laisser reprise humaine / reconcile
        await deps.jobs.complete({
          jobId: job.id,
          leaseToken,
          outcome: {
            kind: "unknown",
            failureCode: "UNKNOWN_PROVIDER_RESULT",
            tentativePaiementId: claimAttempt.tentativeId,
          },
        });
        return mapProviderToDrain(job.id, claimAttempt.tentativeId, provider);
      } catch (error) {
        const code = isPaymentRuntimeError(error)
          ? error.code
          : "PROVIDER_UNAVAILABLE";
        const retryable = isPaymentRuntimeError(error)
          ? error.retryable
          : true;
        try {
          await deps.jobs.complete({
            jobId: job.id,
            leaseToken,
            outcome: {
              kind: retryable ? "failed_retryable" : "failed_terminal",
              failureCode: code,
              tentativePaiementId: tentativeId ?? null,
            },
          });
        } catch {
          // lease lost on complete — surface unknown
          return {
            status: "unknown",
            jobId: job.id,
            code: "LEASE_LOST",
            payment_attempt_id: tentativeId,
          };
        }
        return {
          status: retryable ? "failure" : "failure",
          jobId: job.id,
          code,
          payment_attempt_id: tentativeId,
        };
      }
    },
  };
}
