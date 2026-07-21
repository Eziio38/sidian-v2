import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

import {
  getCurrentPrestataireStripeConnectView,
  projectStripeConnectAccountView,
  shouldOpenConnectedAccountOnboarding,
} from "@/lib/stripe/connect/account-view";

const OPERATION_KEY = "11111111-1111-4111-8111-111111111111";

function accountFixture(
  overrides: Record<string, unknown> = {},
): Stripe.Account {
  return {
    id: "acct_1",
    object: "account",
    type: "express",
    country: "FR",
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
    controller: {
      type: "application",
      requirement_collection: "stripe",
      stripe_dashboard: { type: "express" },
    },
    capabilities: {
      card_payments: "active",
      sepa_debit_payments: "active",
    },
    requirements: {
      currently_due: [],
      pending_verification: [],
      past_due: [],
      disabled_reason: null,
    },
    metadata: {
      sidian_prestataire_id: "prest_1",
      sidian_environment: "local",
      sidian_provisioning_operation_id: OPERATION_KEY,
    },
    ...overrides,
  } as unknown as Stripe.Account;
}

function userClient(stripeAccountId: string | null) {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "user_1" } },
        error: null,
      })),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: {
              id: "prest_1",
              stripe_account_id: stripeAccountId,
              stripe_connect_operation_key: OPERATION_KEY,
            },
            error: null,
          })),
        })),
      })),
    })),
  };
}

describe("vue produit Connect autoritative", () => {
  it("ne crée ni ne lit de compte Stripe tant que le prestataire n'a pas démarré", async () => {
    const retrieve = vi.fn();
    const adminRpc = vi.fn();

    const view = await getCurrentPrestataireStripeConnectView({
      supabaseUser: userClient(null) as never,
      supabaseAdmin: { rpc: adminRpc } as never,
      stripe: { accounts: { retrieve } } as unknown as Stripe,
      sidianEnvironment: "local",
    });

    expect(view).toMatchObject({
      configured: false,
      onboardingStatus: "non_commence",
      requiredRailsActive: false,
    });
    expect(retrieve).not.toHaveBeenCalled();
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("relit Stripe live, resynchronise la projection et n'expose que le DTO utile", async () => {
    const account = accountFixture();
    const retrieve = vi.fn(async () => account);
    const adminRpc = vi.fn(async () => ({ data: true, error: null }));

    const view = await getCurrentPrestataireStripeConnectView({
      supabaseUser: userClient("acct_1") as never,
      supabaseAdmin: { rpc: adminRpc } as never,
      stripe: { accounts: { retrieve } } as unknown as Stripe,
      sidianEnvironment: "local",
    });

    expect(retrieve).toHaveBeenCalledWith("acct_1");
    expect(adminRpc).toHaveBeenCalledWith(
      "sync_prestataire_stripe_projection",
      expect.objectContaining({
        p_prestataire_id: "prest_1",
        p_stripe_account_id: "acct_1",
      }),
    );
    expect(view).toEqual({
      configured: true,
      onboardingStatus: "paiements_actives",
      chargesEnabled: true,
      payoutsEnabled: true,
      cardPaymentsStatus: "active",
      sepaDebitPaymentsStatus: "active",
      currentlyDueCount: 0,
      pendingVerificationCount: 0,
      pastDueCount: 0,
      canOpenOnboarding: false,
      requiredRailsActive: true,
    });
    expect(view).not.toHaveProperty("stripeAccountId");
    expect(view).not.toHaveProperty("requirements");
  });

  it("refuse un compte Stripe d'un autre prestataire avant toute synchronisation", async () => {
    const adminRpc = vi.fn();
    const account = accountFixture({
      metadata: {
        sidian_prestataire_id: "prest_other",
        sidian_environment: "local",
        sidian_provisioning_operation_id: OPERATION_KEY,
      },
    });

    await expect(
      getCurrentPrestataireStripeConnectView({
        supabaseUser: userClient("acct_1") as never,
        supabaseAdmin: { rpc: adminRpc } as never,
        stripe: {
          accounts: { retrieve: vi.fn(async () => account) },
        } as unknown as Stripe,
        sidianEnvironment: "local",
      }),
    ).rejects.toMatchObject({ code: "stripe_account_scope_mismatch" });
    expect(adminRpc).not.toHaveBeenCalled();
  });
});

describe("Account Link Express contextuel", () => {
  it("ouvre l'onboarding seulement pour une première collecte ou une exigence échue", () => {
    expect(
      shouldOpenConnectedAccountOnboarding({
        details_submitted: false,
        requirements: { currently_due: [], past_due: [] } as never,
      }),
    ).toBe(true);
    expect(
      shouldOpenConnectedAccountOnboarding({
        details_submitted: true,
        requirements: {
          currently_due: ["individual.verification.document"],
          past_due: [],
        } as never,
      }),
    ).toBe(true);
    expect(
      shouldOpenConnectedAccountOnboarding({
        details_submitted: true,
        requirements: {
          currently_due: [],
          past_due: [],
          pending_verification: ["individual.verification.document"],
        } as never,
      }),
    ).toBe(false);
  });

  it("ne présente jamais le compte comme prêt si Stripe signale une exigence échue", () => {
    const view = projectStripeConnectAccountView(
      accountFixture({
        requirements: {
          currently_due: [],
          pending_verification: [],
          past_due: ["individual.verification.document"],
          disabled_reason: null,
        },
      }),
    );

    expect(view.chargesEnabled).toBe(true);
    expect(view.cardPaymentsStatus).toBe("active");
    expect(view.sepaDebitPaymentsStatus).toBe("active");
    expect(view.canOpenOnboarding).toBe(true);
    expect(view.requiredRailsActive).toBe(false);
  });
});
