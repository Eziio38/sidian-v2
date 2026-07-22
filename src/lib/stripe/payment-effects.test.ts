import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

import {
  handleChargeDisputeCreated,
  handleCheckoutSessionCompletedPayment,
  handlePaymentIntentPaymentFailed,
  handlePaymentIntentSucceeded,
} from "@/lib/stripe/webhooks/payment-effects";
import { classifyStripeFailure } from "@/lib/stripe/shared/errors";

const lease = {
  eventId: "evt_1",
  attempt: 2,
  leaseToken: "11111111-1111-4111-8111-111111111111",
};

function supabaseWith(rpcImpl: (name: string, args: unknown) => unknown) {
  const rpc = vi.fn(async (name: string, args: unknown) => rpcImpl(name, args));
  const from = vi.fn(() => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: null, error: null }),
      }),
    }),
  }));
  return { supabase: { rpc, from } as never, rpc };
}

function event(type: string, object: unknown, account: string | undefined = "acct_x") {
  return { id: "evt_1", type, account, data: { object } } as Stripe.Event;
}

describe("payment-effects mapping", () => {
  it("diffère une session Checkout `setup` sans appeler la base", async () => {
    const { supabase, rpc } = supabaseWith(() => ({ data: {}, error: null }));
    const result = await handleCheckoutSessionCompletedPayment(
      event("checkout.session.completed", { id: "cs_1", mode: "setup" }),
      { supabase, lease },
    );
    expect(result).toEqual({
      outcome: "ignored",
      reason: "deferred_to_authorization_lot",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("mappe checkout.session.completed (payment) et normalise les identifiants", async () => {
    const { supabase, rpc } = supabaseWith(() => ({ data: { applied: true }, error: null }));
    const result = await handleCheckoutSessionCompletedPayment(
      event("checkout.session.completed", {
        id: "cs_1",
        mode: "payment",
        payment_intent: { id: "pi_1" },
        customer: "cus_1",
      }),
      { supabase, lease },
    );
    expect(result.outcome).toBe("processed");
    expect(rpc).toHaveBeenCalledWith(
      "apply_checkout_session_completed_payment",
      expect.objectContaining({
        p_stripe_event_id: "evt_1",
        p_processing_attempt: 2,
        p_lease_token: lease.leaseToken,
        p_connected_account_id: "acct_x",
        p_checkout_session_id: "cs_1",
        p_payment_intent_id: "pi_1",
        p_customer_id: "cus_1",
      }),
    );
  });

  it("succeeded : montant, tentative métadonnée et moyen dérivé", async () => {
    const { supabase, rpc } = supabaseWith(() => ({ data: { applied: true }, error: null }));
    await handlePaymentIntentSucceeded(
      event("payment_intent.succeeded", {
        id: "pi_1",
        amount: 12000,
        amount_received: 12000,
        currency: "eur",
        payment_method_types: ["card"],
        metadata: { sidian_tentative_id: "22222222-2222-4222-8222-222222222222" },
      }),
      { supabase, lease },
    );
    expect(rpc).toHaveBeenCalledWith(
      "apply_eur_payment_intent_succeeded",
      expect.objectContaining({
        p_payment_intent_id: "pi_1",
        p_tentative_id: "22222222-2222-4222-8222-222222222222",
        p_amount_received: 12000,
        p_currency: "eur",
        p_moyen: "carte",
      }),
    );
  });

  it("succeeded : amount_received absent → repli sur amount", async () => {
    const { supabase, rpc } = supabaseWith(() => ({ data: { applied: true }, error: null }));
    await handlePaymentIntentSucceeded(
      event("payment_intent.succeeded", {
        id: "pi_1",
        amount: 9000,
        currency: "eur",
        payment_method_types: ["card", "sepa_debit"],
        metadata: {},
      }),
      { supabase, lease },
    );
    const call = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(call.p_amount_received).toBe(9000);
    expect(call.p_tentative_id).toBeNull();
    expect(call.p_moyen).toBeNull(); // ambigu → coalescé côté base
  });

  it("payment_failed : code et message normalisés depuis last_payment_error", async () => {
    const { supabase, rpc } = supabaseWith(() => ({ data: { applied: true }, error: null }));
    await handlePaymentIntentPaymentFailed(
      event("payment_intent.payment_failed", {
        id: "pi_1",
        currency: "eur",
        metadata: {},
        last_payment_error: { code: "card_declined", message: "Refusée." },
      }),
      { supabase, lease },
    );
    expect(rpc).toHaveBeenCalledWith(
      "apply_payment_intent_payment_failed",
      expect.objectContaining({
        p_echec_code: "card_declined",
        p_echec_message: "Refusée.",
      }),
    );
  });

  it("succeeded non résolu reste processed lorsque le garde-fou durable est créé", async () => {
    const { supabase } = supabaseWith(() => ({
      data: { applied: true, unresolved: true, reconciliation_required: true },
      error: null,
    }));

    const result = await handlePaymentIntentSucceeded(
      event("payment_intent.succeeded", {
        id: "pi_orphan",
        amount: 12000,
        amount_received: 12000,
        currency: "eur",
        metadata: {},
      }),
      { supabase, lease },
    );

    expect(result).toEqual({
      outcome: "processed",
      detail: "payment_intent_succeeded",
    });
  });

  it("refuse une devise non EUR avant tout appel d'effet financier", async () => {
    const { supabase, rpc } = supabaseWith(() => ({ data: {}, error: null }));
    const error = await handlePaymentIntentSucceeded(
      event("payment_intent.succeeded", {
        id: "pi_usd",
        amount: 12000,
        amount_received: 12000,
        currency: "usd",
        metadata: {},
      }),
      { supabase, lease },
    ).catch((caught) => caught);

    expect(classifyStripeFailure(error).disposition).toBe("terminal");
    expect(error).toMatchObject({ code: "stripe_payment_currency_not_supported" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("charge.dispute.created : mappe dispute, PI et raison", async () => {
    const { supabase, rpc } = supabaseWith(() => ({ data: { applied: true }, error: null }));
    await handleChargeDisputeCreated(
      event("charge.dispute.created", {
        id: "dp_1",
        payment_intent: "pi_1",
        reason: "fraudulent",
      }),
      { supabase, lease },
    );
    expect(rpc).toHaveBeenCalledWith(
      "apply_charge_dispute_created_effects",
      expect.objectContaining({
        p_dispute_id: "dp_1",
        p_payment_intent_id: "pi_1",
        p_reason: "fraudulent",
      }),
    );
  });

  it("propage webhook_lease_lost sans réécriture (disposition lease_lost)", async () => {
    const { supabase } = supabaseWith(() => ({
      data: null,
      error: { message: "webhook_lease_lost" },
    }));
    await expect(
      handlePaymentIntentSucceeded(
        event("payment_intent.succeeded", {
          id: "pi_1",
          amount: 12000,
          amount_received: 12000,
          currency: "eur",
          metadata: {},
        }),
        { supabase, lease },
      ),
    ).rejects.toMatchObject({ code: "webhook_lease_lost" });
  });

  it("un rejet de scope est terminal (jamais rejoué)", async () => {
    const { supabase } = supabaseWith(() => ({
      data: null,
      error: { message: "webhook_tentative_scope_mismatch" },
    }));
    const error = await handlePaymentIntentSucceeded(
      event("payment_intent.succeeded", {
        id: "pi_1",
        amount: 12000,
        amount_received: 12000,
        currency: "eur",
        metadata: {},
      }),
      { supabase, lease },
    ).catch((caught) => caught);
    expect(classifyStripeFailure(error).disposition).toBe("terminal");
  });

  it("refuse un événement sans compte connecté (terminal)", async () => {
    const { supabase } = supabaseWith(() => ({ data: {}, error: null }));
    const error = await handlePaymentIntentSucceeded(
      event(
        "payment_intent.succeeded",
        {
          id: "pi_1",
          amount: 12000,
          amount_received: 12000,
          currency: "eur",
          metadata: {},
        },
        "",
      ),
      { supabase, lease },
    ).catch((caught) => caught);
    expect(classifyStripeFailure(error).disposition).toBe("terminal");
  });
});
