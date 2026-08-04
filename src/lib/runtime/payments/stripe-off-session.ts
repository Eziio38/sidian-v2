import "server-only";

import type Stripe from "stripe";

import { getStripeClient } from "@/lib/stripe/client";
import { classifyStripeFailure } from "@/lib/stripe/shared/errors";

import {
  PAYMENT_RUNTIME_STRIPE_CURRENCY,
} from "./constants";
import type { OffSessionProviderOutcome } from "./types";

export type CreateOffSessionPaymentIntentInput = {
  stripeAccountId: string;
  stripeCustomerId: string;
  stripePaymentMethodId: string;
  amountCents: number;
  creanceId: string;
  tentativeId: string;
  authorizationId: string;
  applicationFeeAmount: number;
  idempotencyKey: string;
  stripe?: Stripe;
};

/**
 * Crée un PaymentIntent off-session carte (direct charge Connect).
 * Ne marque jamais la créance / tentative comme payée — webhook = SoT.
 */
export async function createOffSessionCardPaymentIntent(
  input: CreateOffSessionPaymentIntentInput,
): Promise<OffSessionProviderOutcome> {
  const stripe = input.stripe ?? getStripeClient();

  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount: input.amountCents,
        currency: PAYMENT_RUNTIME_STRIPE_CURRENCY,
        customer: input.stripeCustomerId,
        payment_method: input.stripePaymentMethodId,
        payment_method_types: ["card"],
        confirm: true,
        off_session: true,
        application_fee_amount: input.applicationFeeAmount,
        metadata: {
          sidian_creance_id: input.creanceId,
          sidian_tentative_id: input.tentativeId,
          sidian_payment_authorization_id: input.authorizationId,
          sidian_source: "prelevement_auto",
        },
      },
      {
        stripeAccount: input.stripeAccountId,
        idempotencyKey: input.idempotencyKey,
      },
    );

    return {
      kind: "created",
      paymentIntentId: pi.id,
      providerStatus: pi.status,
      requiresAction:
        pi.status === "requires_action" ||
        pi.status === "requires_confirmation",
    };
  } catch (error) {
    const classified = classifyStripeFailure(error);
    if (classified.disposition === "retryable") {
      return {
        kind: "temporary_failure",
        code: classified.code,
        retryable: true,
      };
    }

    // Ambiguïté réseau après envoi : ne pas rejouer aveuglément.
    if (
      error &&
      typeof error === "object" &&
      "type" in error &&
      String((error as { type?: string }).type) === "StripeConnectionError"
    ) {
      return { kind: "unknown", code: classified.code };
    }

    return {
      kind: "permanent_failure",
      code: classified.code,
      retryable: false,
    };
  }
}
