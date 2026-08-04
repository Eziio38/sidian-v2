import { describe, expect, it } from "vitest";
import type Stripe from "stripe";

import {
  inspectLivePaymentAttempt,
  type LiveReconciliationObjects,
  type LocalReconciliationAttempt,
} from "./payment-reconciliation-core";

const local: LocalReconciliationAttempt = {
  id: "11111111-1111-4111-8111-111111111111",
  creanceId: "22222222-2222-4222-8222-222222222222",
  prestataireId: "33333333-3333-4333-8333-333333333333",
  clientPayeurId: "44444444-4444-4444-8444-444444444444",
  stripeAccountId: "acct_sidian_reconciliation",
  stripeCheckoutSessionId: "cs_reconciliation",
  stripePaymentIntentId: null,
  stripeCustomerId: null,
  amount: 12_500,
  applicationFeeAmount: 0,
  currency: "EUR",
  source: "lien_agent",
  moyen: null,
  state: "CREEE",
  confirmedPayment: null,
  sidianEnvironment: "staging",
};

function liveObjects(input?: {
  paymentIntentStatus?: Stripe.PaymentIntent.Status;
  sessionStatus?: Stripe.Checkout.Session.Status;
  paymentStatus?: Stripe.Checkout.Session.PaymentStatus;
  currency?: string;
  amount?: number;
  customerPrestataireId?: string;
  applicationFeeAmount?: number;
}): LiveReconciliationObjects {
  const paymentIntentStatus = input?.paymentIntentStatus ?? "succeeded";
  const sessionStatus = input?.sessionStatus ?? "complete";
  const paymentStatus = input?.paymentStatus ?? "paid";
  const currency = input?.currency ?? "eur";
  const amount = input?.amount ?? local.amount;

  return {
    account: {
      id: local.stripeAccountId,
      object: "account",
      metadata: {
        sidian_prestataire_id: local.prestataireId,
        sidian_environment: local.sidianEnvironment,
      },
    } as unknown as Stripe.Account,
    session: {
      id: local.stripeCheckoutSessionId,
      object: "checkout.session",
      mode: "payment",
      status: sessionStatus,
      payment_status: paymentStatus,
      currency,
      amount_total: amount,
      client_reference_id: local.id,
      payment_intent: "pi_reconciliation",
      customer: "cus_reconciliation",
      metadata: {
        sidian_tentative_id: local.id,
        sidian_creance_id: local.creanceId,
      },
    } as unknown as Stripe.Checkout.Session,
    paymentIntent: {
      id: "pi_reconciliation",
      object: "payment_intent",
      status: paymentIntentStatus,
      currency,
      amount,
      amount_received: paymentIntentStatus === "succeeded" ? amount : 0,
      application_fee_amount: input?.applicationFeeAmount ?? 0,
      customer: "cus_reconciliation",
      payment_method_types: ["card", "sepa_debit"],
      latest_charge: {
        id: "ch_reconciliation",
        object: "charge",
        payment_method_details: { type: "card" },
      },
      metadata: {
        sidian_tentative_id: local.id,
        sidian_creance_id: local.creanceId,
      },
    } as unknown as Stripe.PaymentIntent,
    customer: {
      id: "cus_reconciliation",
      object: "customer",
      deleted: false,
      metadata: {
        sidian_prestataire_id:
          input?.customerPrestataireId ?? local.prestataireId,
        sidian_client_payeur_id: local.clientPayeurId,
        sidian_environment: local.sidianEnvironment,
      },
    } as unknown as Stripe.Customer,
  };
}

describe("inspection de réconciliation Stripe live", () => {
  it("répare le binding puis le succès uniquement après concordance complète", () => {
    const result = inspectLivePaymentAttempt({ local, live: liveObjects() });

    expect(result.outcome).toBe("safe");
    if (result.outcome !== "safe") return;
    expect(result.effects).toEqual([
      "checkout.session.completed",
      "payment_intent.succeeded",
    ]);
    expect(result.observation).toMatchObject({
      session_currency: "eur",
      payment_intent_currency: "eur",
      payment_intent_amount_received: local.amount,
      payment_intent_application_fee_amount: 0,
      moyen: "carte",
    });
  });

  it("considère un succès déjà payé comme à jour sans rejouer l'effet", () => {
    const result = inspectLivePaymentAttempt({
      local: {
        ...local,
        stripePaymentIntentId: "pi_reconciliation",
        stripeCustomerId: "cus_reconciliation",
        moyen: "carte",
        state: "REUSSIE",
        confirmedPayment: { amount: local.amount, source: "lien_agent" },
      },
      live: liveObjects(),
    });

    expect(result).toMatchObject({ outcome: "safe", effects: [] });
  });

  it("projette seulement EN_TRAITEMENT pour un SEPA réellement processing", () => {
    const objects = liveObjects({
      paymentIntentStatus: "processing",
      paymentStatus: "unpaid",
    });
    (objects.paymentIntent.latest_charge as Stripe.Charge).payment_method_details = {
      type: "sepa_debit",
    } as Stripe.Charge.PaymentMethodDetails;

    const result = inspectLivePaymentAttempt({ local, live: objects });

    expect(result).toMatchObject({
      outcome: "safe",
      effects: [
        "checkout.session.completed",
        "payment_intent.processing",
      ],
      observation: { moyen: "sepa_core" },
    });
  });

  it("laisse une Session ouverte en attente sans effet local", () => {
    const result = inspectLivePaymentAttempt({
      local,
      live: liveObjects({
        paymentIntentStatus: "requires_payment_method",
        sessionStatus: "open",
        paymentStatus: "unpaid",
      }),
    });

    expect(result).toEqual({ outcome: "pending" });
  });

  it("refuse fermé une devise ou un montant divergents", () => {
    expect(
      inspectLivePaymentAttempt({
        local,
        live: liveObjects({ currency: "usd" }),
      }),
    ).toEqual({
      outcome: "human_required",
      reason: "stripe_currency_mismatch",
    });

    expect(
      inspectLivePaymentAttempt({
        local,
        live: liveObjects({ amount: local.amount + 1 }),
      }),
    ).toEqual({
      outcome: "human_required",
      reason: "stripe_amount_mismatch",
    });
  });

  it("refuse un Customer d’un autre prestataire", () => {
    const result = inspectLivePaymentAttempt({
      local,
      live: liveObjects({
        customerPrestataireId: "55555555-5555-4555-8555-555555555555",
      }),
    });

    expect(result).toEqual({
      outcome: "human_required",
      reason: "customer_identity_mismatch",
    });
  });

  it("refuse une commission Stripe divergente de la tentative locale", () => {
    const result = inspectLivePaymentAttempt({
      local,
      live: liveObjects({ applicationFeeAmount: 50 }),
    });

    expect(result).toEqual({
      outcome: "human_required",
      reason: "payment_intent_identity_mismatch",
    });
  });
});
