import type Stripe from "stripe";
import { describe, expect, it } from "vitest";

import {
  assertPaymentIntentProjectionIdentity,
  resolveAndAssertPaymentIntentIdentity,
  type PaymentIntentAttemptProjection,
} from "./payment-intent-identity";

const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";
const RECEIVABLE_ID = "22222222-2222-4222-8222-222222222222";

const attempt: PaymentIntentAttemptProjection = {
  id: ATTEMPT_ID,
  creance_id: RECEIVABLE_ID,
  montant: 12_500,
  stripe_account_id: "acct_expected",
  stripe_customer_id: "cus_expected",
  stripe_payment_intent_id: "pi_expected",
  application_fee_amount: 0,
};

function paymentIntent(
  overrides: Partial<Stripe.PaymentIntent> = {},
): Stripe.PaymentIntent {
  return {
    id: "pi_expected",
    object: "payment_intent",
    amount: 12_500,
    currency: "eur",
    customer: "cus_expected",
    application_fee_amount: null,
    metadata: {
      sidian_tentative_id: ATTEMPT_ID,
      sidian_creance_id: RECEIVABLE_ID,
    },
    ...overrides,
  } as Stripe.PaymentIntent;
}

describe("identité PaymentIntent webhook", () => {
  it("accepte la concordance complète EUR/tenant/Customer/montant", () => {
    expect(() =>
      assertPaymentIntentProjectionIdentity({
        paymentIntent: paymentIntent(),
        connectedAccountId: "acct_expected",
        attempt,
      }),
    ).not.toThrow();
  });

  it.each([
    ["compte", paymentIntent(), "acct_other"],
    ["devise", paymentIntent({ currency: "usd" }), "acct_expected"],
    ["montant", paymentIntent({ amount: 12_501 }), "acct_expected"],
    ["Customer", paymentIntent({ customer: "cus_other" }), "acct_expected"],
    [
      "métadonnée tentative",
      paymentIntent({
        metadata: {
          sidian_tentative_id: "33333333-3333-4333-8333-333333333333",
          sidian_creance_id: RECEIVABLE_ID,
        },
      }),
      "acct_expected",
    ],
    [
      "métadonnée paiement à recevoir",
      paymentIntent({
        metadata: {
          sidian_tentative_id: ATTEMPT_ID,
          sidian_creance_id: "44444444-4444-4444-8444-444444444444",
        },
      }),
      "acct_expected",
    ],
    [
      "commission",
      paymentIntent({ application_fee_amount: 50 }),
      "acct_expected",
    ],
  ])("refuse une divergence de %s", (_label, pi, connectedAccountId) => {
    expect(() =>
      assertPaymentIntentProjectionIdentity({
        paymentIntent: pi as Stripe.PaymentIntent,
        connectedAccountId: connectedAccountId as string,
        attempt,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "webhook_payment_intent_identity_mismatch",
        disposition: "terminal",
      }),
    );
  });

  it("refuse l’absence d’identités minimales", () => {
    expect(() =>
      assertPaymentIntentProjectionIdentity({
        paymentIntent: paymentIntent({ customer: null, metadata: {} }),
        connectedAccountId: "acct_expected",
        attempt,
      }),
    ).toThrow();
  });

  it("résout la projection concordante par identifiant Stripe et métadonnée", async () => {
    const supabase = fakeSupabase((column, value) => {
      if (
        (column === "stripe_payment_intent_id" && value === "pi_expected") ||
        (column === "id" && value === ATTEMPT_ID)
      ) {
        return attempt;
      }
      return null;
    });

    await expect(
      resolveAndAssertPaymentIntentIdentity({
        supabase,
        paymentIntent: paymentIntent(),
        connectedAccountId: "acct_expected",
      }),
    ).resolves.toEqual(attempt);
  });

  it("refuse deux résolutions locales contradictoires", async () => {
    const otherAttempt = {
      ...attempt,
      id: "55555555-5555-4555-8555-555555555555",
    };
    const supabase = fakeSupabase((column) =>
      column === "stripe_payment_intent_id" ? otherAttempt : attempt,
    );

    await expect(
      resolveAndAssertPaymentIntentIdentity({
        supabase,
        paymentIntent: paymentIntent(),
        connectedAccountId: "acct_expected",
      }),
    ).rejects.toMatchObject({
      code: "webhook_payment_intent_identity_mismatch",
      disposition: "terminal",
    });
  });

  it("laisse le SQL créer le rapprochement durable d’un succès orphelin", async () => {
    const supabase = fakeSupabase(() => null);

    await expect(
      resolveAndAssertPaymentIntentIdentity({
        supabase,
        paymentIntent: paymentIntent({
          id: "pi_orphan",
          metadata: {},
          customer: null,
        }),
        connectedAccountId: "acct_expected",
      }),
    ).resolves.toBeNull();
  });
});

function fakeSupabase(
  resolve: (
    column: "id" | "stripe_payment_intent_id",
    value: string,
  ) => PaymentIntentAttemptProjection | null,
) {
  return {
    from: () => ({
      select: () => ({
        eq: (column: "id" | "stripe_payment_intent_id", value: string) => ({
          maybeSingle: async () => ({ data: resolve(column, value), error: null }),
        }),
      }),
    }),
  } as unknown as Parameters<
    typeof resolveAndAssertPaymentIntentIdentity
  >[0]["supabase"];
}
