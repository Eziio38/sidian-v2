import { describe, expect, it, vi } from "vitest";

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  handleSidianInvoicePaymentFailed,
  handleSidianSubscriptionLifecycle,
} from "@/lib/stripe/billing/effects";
import { StripeDomainError } from "@/lib/stripe/shared/errors";
import type { Database } from "@/types/database.generated";

type AdminClient = SupabaseClient<Database>;

function supabaseWith(
  response: { data?: unknown; error?: { message: string } | null } = {},
) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    return {
      data: response.data ?? { applied: true },
      error: response.error ?? null,
    };
  });
  return { client: { rpc } as unknown as AdminClient, rpc, calls };
}

function subscriptionEvent(
  overrides: Partial<Stripe.Subscription> = {},
  eventOverrides: Partial<Stripe.Event> = {},
): Stripe.Event {
  return {
    id: "evt_sub_1",
    type: "customer.subscription.updated",
    created: 1_785_000_000,
    data: {
      object: {
        object: "subscription",
        id: "sub_1",
        customer: "cus_1",
        status: "active",
        cancel_at_period_end: false,
        items: {
          data: [
            {
              current_period_end: 1_787_000_000,
              price: { id: "price_1" },
            },
          ],
        },
        ...overrides,
      },
    },
    ...eventOverrides,
  } as unknown as Stripe.Event;
}

function invoiceEvent(overrides: Record<string, unknown> = {}): Stripe.Event {
  return {
    id: "evt_inv_1",
    type: "invoice.payment_failed",
    created: 1_785_000_500,
    data: {
      object: {
        object: "invoice",
        id: "in_1",
        customer: "cus_1",
        parent: {
          type: "subscription_details",
          subscription_details: { subscription: "sub_1" },
        },
        ...overrides,
      },
    },
  } as unknown as Stripe.Event;
}

describe("handleSidianSubscriptionLifecycle", () => {
  it("projette l'abonnement vers la RPC avec la fin de période des items", async () => {
    const { client, rpc } = supabaseWith();

    const result = await handleSidianSubscriptionLifecycle(
      subscriptionEvent(),
      { supabase: client, earlyAccessLockMonths: 12 },
    );

    expect(result).toEqual({
      outcome: "processed",
      detail: "customer.subscription.updated",
    });
    expect(rpc).toHaveBeenCalledWith("apply_sidian_subscription_event", {
      p_stripe_event_id: "evt_sub_1",
      p_event_type: "customer.subscription.updated",
      p_event_created_at: new Date(1_785_000_000 * 1000).toISOString(),
      p_stripe_customer_id: "cus_1",
      p_stripe_subscription_id: "sub_1",
      p_stripe_status: "active",
      p_stripe_price_id: "price_1",
      p_current_period_end: new Date(1_787_000_000 * 1000).toISOString(),
      p_cancel_at_period_end: false,
      p_early_access_lock_months: 12,
    });
  });

  it("retient la fin de période la plus tardive des items", async () => {
    const { client, calls } = supabaseWith();

    await handleSidianSubscriptionLifecycle(
      subscriptionEvent({
        items: {
          data: [
            { current_period_end: 1_786_000_000, price: { id: "price_1" } },
            { current_period_end: 1_789_000_000, price: { id: "price_2" } },
          ],
        },
      } as unknown as Partial<Stripe.Subscription>),
      { supabase: client, earlyAccessLockMonths: null },
    );

    expect(calls[0]?.args).toMatchObject({
      p_current_period_end: new Date(1_789_000_000 * 1000).toISOString(),
    });
  });

  it("rejette de façon terminale un événement portant un compte connecté", async () => {
    const { client, rpc } = supabaseWith();

    await expect(
      handleSidianSubscriptionLifecycle(
        subscriptionEvent({}, { account: "acct_123" } as Partial<Stripe.Event>),
        { supabase: client, earlyAccessLockMonths: null },
      ),
    ).rejects.toMatchObject({
      code: "sidian_billing_connected_event_rejected",
      disposition: "terminal",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejette un objet qui n'est pas un abonnement", async () => {
    const { client } = supabaseWith();

    await expect(
      handleSidianSubscriptionLifecycle(
        subscriptionEvent({ object: "charge" } as unknown as Partial<Stripe.Subscription>),
        { supabase: client, earlyAccessLockMonths: null },
      ),
    ).rejects.toBeInstanceOf(StripeDomainError);
  });

  it("traduit un rejeu en 'ignored' plutôt qu'en succès", async () => {
    const { client } = supabaseWith({
      data: { applied: false, reason: "already_applied" },
    });

    await expect(
      handleSidianSubscriptionLifecycle(subscriptionEvent(), {
        supabase: client,
        earlyAccessLockMonths: null,
      }),
    ).resolves.toEqual({ outcome: "ignored", reason: "already_applied" });
  });

  it("traduit l'absence de binding en 'ignored'", async () => {
    const { client } = supabaseWith({
      data: { applied: false, reason: "no_binding_for_customer" },
    });

    await expect(
      handleSidianSubscriptionLifecycle(subscriptionEvent(), {
        supabase: client,
        earlyAccessLockMonths: null,
      }),
    ).resolves.toEqual({
      outcome: "ignored",
      reason: "no_binding_for_customer",
    });
  });

  it("classe en terminal une violation d'identité SQL", async () => {
    const { client } = supabaseWith({
      error: { message: "billing_subscription_identity_mismatch" },
    });

    await expect(
      handleSidianSubscriptionLifecycle(subscriptionEvent(), {
        supabase: client,
        earlyAccessLockMonths: null,
      }),
    ).rejects.toMatchObject({ disposition: "terminal" });
  });

  it("classe en retryable une panne SQL générique", async () => {
    const { client } = supabaseWith({ error: { message: "connection reset" } });

    await expect(
      handleSidianSubscriptionLifecycle(subscriptionEvent(), {
        supabase: client,
        earlyAccessLockMonths: null,
      }),
    ).rejects.toMatchObject({ disposition: "retryable" });
  });
});

describe("handleSidianInvoicePaymentFailed", () => {
  it("transmet la facture et l'abonnement parent", async () => {
    const { client, rpc } = supabaseWith();

    const result = await handleSidianInvoicePaymentFailed(invoiceEvent(), {
      supabase: client,
    });

    expect(result).toEqual({
      outcome: "processed",
      detail: "invoice.payment_failed",
    });
    expect(rpc).toHaveBeenCalledWith(
      "apply_sidian_subscription_payment_failure",
      {
        p_stripe_event_id: "evt_inv_1",
        p_event_created_at: new Date(1_785_000_500 * 1000).toISOString(),
        p_stripe_customer_id: "cus_1",
        p_stripe_invoice_id: "in_1",
        p_stripe_subscription_id: "sub_1",
      },
    );
  });

  it("ignore une facture hors abonnement", async () => {
    const { client, rpc } = supabaseWith();

    await expect(
      handleSidianInvoicePaymentFailed(invoiceEvent({ parent: null }), {
        supabase: client,
      }),
    ).resolves.toEqual({
      outcome: "ignored",
      reason: "invoice_not_subscription_scoped",
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});
