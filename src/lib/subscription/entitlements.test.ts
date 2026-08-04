import { describe, expect, it } from "vitest";

import {
  isStripeSubscriptionOpen,
  resolveSubscriptionEntitlements,
  type SubscriptionBindingSnapshot,
} from "@/lib/subscription/entitlements";

function binding(
  overrides: Partial<SubscriptionBindingSnapshot> = {},
): SubscriptionBindingSnapshot {
  return {
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: "sub_123",
    stripeStatus: "active",
    currentPeriodEnd: "2026-09-03T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

describe("resolveSubscriptionEntitlements", () => {
  it("laisse 'trialing' permissif — comportement documenté des comptes existants", () => {
    const result = resolveSubscriptionEntitlements({
      status: "trialing",
      billingConfigured: true,
      binding: null,
    });

    expect(result.capabilities.product_access).toBe(true);
    expect(result.state).toBe("no_subscription");
  });

  it("laisse 'past_due' accéder au produit — aucune dégradation n'est documentée", () => {
    const result = resolveSubscriptionEntitlements({
      status: "past_due",
      billingConfigured: true,
      binding: binding({ stripeStatus: "past_due" }),
    });

    expect(result.capabilities.product_access).toBe(true);
    expect(result.state).toBe("past_due");
  });

  it("coupe l'accès produit sur 'cancelled'", () => {
    const result = resolveSubscriptionEntitlements({
      status: "cancelled",
      billingConfigured: true,
      binding: binding({ stripeStatus: "canceled" }),
    });

    expect(result.capabilities.product_access).toBe(false);
    expect(result.state).toBe("cancelled");
  });

  it("sans configuration Stripe, aucune capacité de facturation n'est offerte", () => {
    const result = resolveSubscriptionEntitlements({
      status: "trialing",
      billingConfigured: false,
      binding: null,
    });

    expect(result.state).toBe("billing_unavailable");
    expect(result.capabilities.billing_start_subscription).toBe(false);
    expect(result.capabilities.billing_manage_subscription).toBe(false);
    // Le produit reste utilisable : l'absence de facturation n'est pas une sanction.
    expect(result.capabilities.product_access).toBe(true);
  });

  it("n'annonce jamais un abonnement qui n'existe pas côté Stripe", () => {
    const result = resolveSubscriptionEntitlements({
      status: "active",
      billingConfigured: true,
      binding: null,
    });

    expect(result.hasOpenStripeSubscription).toBe(false);
    expect(result.state).toBe("no_subscription");
    expect(result.capabilities.billing_start_subscription).toBe(true);
    expect(result.capabilities.billing_manage_subscription).toBe(false);
  });

  it("interdit un second Checkout tant qu'un abonnement Stripe est ouvert", () => {
    const result = resolveSubscriptionEntitlements({
      status: "active",
      billingConfigured: true,
      binding: binding(),
    });

    expect(result.capabilities.billing_start_subscription).toBe(false);
    expect(result.capabilities.billing_manage_subscription).toBe(true);
  });

  it("réautorise un Checkout après résiliation", () => {
    const result = resolveSubscriptionEntitlements({
      status: "cancelled",
      billingConfigured: true,
      binding: binding({ stripeStatus: "canceled" }),
    });

    expect(result.capabilities.billing_start_subscription).toBe(true);
    expect(result.capabilities.billing_manage_subscription).toBe(true);
  });

  it("garde le portail accessible avec un Customer mais sans abonnement", () => {
    const result = resolveSubscriptionEntitlements({
      status: "trialing",
      billingConfigured: true,
      binding: binding({ stripeSubscriptionId: null, stripeStatus: null }),
    });

    expect(result.capabilities.billing_manage_subscription).toBe(true);
    expect(result.capabilities.billing_start_subscription).toBe(true);
  });
});

describe("isStripeSubscriptionOpen", () => {
  it.each(["active", "trialing", "past_due", "unpaid", "paused", "incomplete"])(
    "considère %s comme encore ouvert",
    (status) => {
      expect(isStripeSubscriptionOpen(status)).toBe(true);
    },
  );

  it.each(["canceled", "cancelled", "incomplete_expired", "", null, undefined])(
    "considère %s comme clos",
    (status) => {
      expect(isStripeSubscriptionOpen(status)).toBe(false);
    },
  );
});
