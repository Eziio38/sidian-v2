import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

import {
  handleCheckoutSessionCompletedSetup,
  handleMandateUpdatedAuthorization,
  handlePaymentMethodDetachedAuthorization,
  handleSetupIntentSucceededAuthorization,
} from "./authorization-effects";

const lease = {
  eventId: "evt_1",
  attempt: 2,
  leaseToken: "11111111-1111-4111-8111-111111111111",
};

function event(type: string, object: unknown): Stripe.Event {
  return {
    id: "evt_1",
    type,
    account: "acct_1",
    data: { object },
  } as Stripe.Event;
}

function context(stripe?: Stripe) {
  const rpc = vi.fn(async () => ({ data: { applied: true }, error: null }));
  const renewLease = vi.fn(async () => undefined);
  return {
    value: { supabase: { rpc } as never, stripe, lease, renewLease },
    rpc,
    renewLease,
  };
}

describe("effets webhook autorisation", () => {
  it("checkout.session.completed setup rattache SI/Customer sans activer seul", async () => {
    const ctx = context();
    const result = await handleCheckoutSessionCompletedSetup(
      event("checkout.session.completed", {
        id: "cs_setup",
        object: "checkout.session",
        mode: "setup",
        setup_intent: "seti_1",
        customer: "cus_1",
      }),
      ctx.value,
    );

    expect(result).toEqual({
      outcome: "processed",
      detail: "checkout_session_completed_setup",
    });
    expect(ctx.rpc).toHaveBeenCalledWith(
      "apply_checkout_session_completed_setup",
      expect.objectContaining({
        p_connected_account_id: "acct_1",
        p_checkout_session_id: "cs_setup",
        p_setup_intent_id: "seti_1",
        p_customer_id: "cus_1",
      }),
    );
  });

  it("setup_intent.succeeded SEPA revérifie PM et mandat multi-use actifs", async () => {
    const stripe = {
      paymentMethods: {
        retrieve: vi.fn(async () => ({
          id: "pm_1",
          object: "payment_method",
          type: "sepa_debit",
          customer: "cus_1",
        })),
      },
      mandates: {
        retrieve: vi.fn(async () => ({
          id: "mandate_1",
          object: "mandate",
          type: "multi_use",
          status: "active",
          payment_method: "pm_1",
        })),
      },
    } as unknown as Stripe;
    const ctx = context(stripe);
    const result = await handleSetupIntentSucceededAuthorization(
      event("setup_intent.succeeded", {
        id: "seti_1",
        object: "setup_intent",
        status: "succeeded",
        usage: "off_session",
        customer: "cus_1",
        payment_method: "pm_1",
        mandate: "mandate_1",
        metadata: {
          sidian_payment_authorization_id:
            "22222222-2222-4222-8222-222222222222",
          sidian_authorization_text_version:
            "sidian-future-payments-fr-v1",
        },
      }),
      ctx.value,
    );

    expect(result).toEqual({
      outcome: "processed",
      detail: "setup_intent_succeeded",
    });
    expect(ctx.renewLease).toHaveBeenCalledTimes(3);
    expect(ctx.rpc).toHaveBeenCalledWith(
      "apply_setup_intent_succeeded_authorization",
      expect.objectContaining({
        p_setup_intent_id: "seti_1",
        p_authorization_id: "22222222-2222-4222-8222-222222222222",
        p_authorization_text_version: "sidian-future-payments-fr-v1",
        p_payment_method_id: "pm_1",
        p_payment_method_type: "sepa_debit",
        p_mandate_id: "mandate_1",
        p_mandate_status: "active",
      }),
    );
  });

  it("refuse un SetupIntent sans version de consentement avant toute lecture live", async () => {
    const stripe = {
      paymentMethods: { retrieve: vi.fn() },
      mandates: { retrieve: vi.fn() },
    } as unknown as Stripe;
    const ctx = context(stripe);

    await expect(
      handleSetupIntentSucceededAuthorization(
        event("setup_intent.succeeded", {
          id: "seti_1",
          object: "setup_intent",
          status: "succeeded",
          usage: "off_session",
          customer: "cus_1",
          payment_method: "pm_1",
          metadata: {
            sidian_payment_authorization_id:
              "22222222-2222-4222-8222-222222222222",
          },
        }),
        ctx.value,
      ),
    ).rejects.toMatchObject({
      code: "setup_authorization_object_invalid",
      disposition: "terminal",
    });
    expect(stripe.paymentMethods.retrieve).not.toHaveBeenCalled();
    expect(ctx.rpc).not.toHaveBeenCalled();
  });

  it("payment_method.detached transmet uniquement l'identité fencée", async () => {
    const ctx = context();
    await handlePaymentMethodDetachedAuthorization(
      event("payment_method.detached", {
        id: "pm_1",
        object: "payment_method",
      }),
      ctx.value,
    );
    expect(ctx.rpc).toHaveBeenCalledWith(
      "apply_payment_method_detached_authorization",
      expect.objectContaining({
        p_stripe_event_id: lease.eventId,
        p_processing_attempt: lease.attempt,
        p_lease_token: lease.leaseToken,
        p_connected_account_id: "acct_1",
        p_payment_method_id: "pm_1",
      }),
    );
  });

  it("mandate.updated revérifie le Customer avant toute réactivation/révocation", async () => {
    const stripe = {
      paymentMethods: {
        retrieve: vi.fn(async () => ({
          id: "pm_1",
          type: "sepa_debit",
          customer: "cus_1",
        })),
      },
    } as unknown as Stripe;
    const ctx = context(stripe);
    await handleMandateUpdatedAuthorization(
      event("mandate.updated", {
        id: "mandate_1",
        object: "mandate",
        status: "inactive",
        payment_method: "pm_1",
      }),
      ctx.value,
    );
    expect(ctx.rpc).toHaveBeenCalledWith(
      "apply_mandate_updated_authorization",
      expect.objectContaining({
        p_mandate_id: "mandate_1",
        p_mandate_status: "inactive",
        p_payment_method_id: "pm_1",
        p_customer_id: "cus_1",
      }),
    );
  });
});
