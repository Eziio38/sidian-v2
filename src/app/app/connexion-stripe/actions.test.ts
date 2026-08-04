import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireConfirmedUser: vi.fn(async () => ({ id: "user_1" })),
  createClient: vi.fn(async () => ({ kind: "user" })),
  createAdminClient: vi.fn(async () => ({ kind: "admin" })),
  ensurePrestataire: vi.fn(async () => ({ id: "prest_1" })),
  ensureAccount: vi.fn(),
  projectView: vi.fn(),
  getView: vi.fn(),
  createAccountLink: vi.fn(),
  getProductContext: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`redirect:${destination}`);
  }),
  logServerEvent: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/session", () => ({
  requireConfirmedUser: mocks.requireConfirmedUser,
}));
vi.mock("@/lib/auth/ensure-prestataire", () => ({
  ensurePrestataireForUser: mocks.ensurePrestataire,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/stripe/connect/ensure-connected-account", () => ({
  ensureConnectedAccountForCurrentPrestataire: mocks.ensureAccount,
}));
vi.mock("@/lib/stripe/connect/create-account-link", () => ({
  createConnectedAccountLink: mocks.createAccountLink,
}));
vi.mock("@/lib/stripe/connect/account-view", () => ({
  getCurrentPrestataireStripeConnectView: mocks.getView,
  projectStripeConnectAccountView: mocks.projectView,
}));
vi.mock("@/lib/stripe/connect/product-context", () => ({
  getStripeConnectProductContext: mocks.getProductContext,
}));
vi.mock("@/lib/observability/server-logger", () => ({
  logServerEvent: mocks.logServerEvent,
}));

import {
  beginStripeConnectAction,
  refreshStripeConnectAction,
} from "@/app/app/connexion-stripe/actions";

const READY_VIEW = {
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
};

describe("actions produit Stripe Connect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureAccount.mockResolvedValue({ account: { id: "acct_1" } });
    mocks.projectView.mockReturnValue({
      ...READY_VIEW,
      configured: true,
      canOpenOnboarding: true,
      requiredRailsActive: false,
      onboardingStatus: "informations_requises",
      currentlyDueCount: 1,
    });
    mocks.createAccountLink.mockResolvedValue({
      url: "https://connect.stripe.com/setup/test",
    });
    mocks.getView.mockResolvedValue(READY_VIEW);
    mocks.getProductContext.mockResolvedValue({
      hasConnectedAccount: false,
      hasReceivable: true,
    });
  });

  it("authentifie, provisionne/réconcilie puis ouvre un onboarding Stripe frais", async () => {
    await expect(
      beginStripeConnectAction(undefined, new FormData()),
    ).rejects.toThrow("redirect:https://connect.stripe.com/setup/test");

    expect(mocks.requireConfirmedUser).toHaveBeenCalledOnce();
    expect(mocks.ensurePrestataire).toHaveBeenCalledWith(
      { kind: "user" },
      { id: "user_1" },
    );
    expect(mocks.ensureAccount).toHaveBeenCalledWith({
      supabaseUser: { kind: "user" },
      supabaseAdmin: { kind: "admin" },
    });
    expect(mocks.createAccountLink).toHaveBeenCalledWith({
      supabaseUser: { kind: "user" },
      kind: "onboarding",
    });
    expect(mocks.redirect).toHaveBeenCalledWith(
      "https://connect.stripe.com/setup/test",
    );
  });

  it("ne crée aucun Account Link inutile quand le compte est déjà prêt", async () => {
    mocks.projectView.mockReturnValue(READY_VIEW);

    const result = await beginStripeConnectAction(undefined, new FormData());

    expect(result).toEqual({
      status: "success",
      message: "Votre compte Stripe est déjà prêt pour les encaissements.",
    });
    expect(mocks.createAccountLink).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("refuse de créer le premier compte avant le premier paiement à recevoir", async () => {
    mocks.getProductContext.mockResolvedValue({
      hasConnectedAccount: false,
      hasReceivable: false,
    });

    const result = await beginStripeConnectAction(undefined, new FormData());

    expect(result).toEqual({
      status: "error",
      message:
        "Créez d’abord un paiement à recevoir. Stripe sera proposé juste avant de rendre son lien partageable.",
    });
    expect(mocks.ensureAccount).not.toHaveBeenCalled();
    expect(mocks.createAccountLink).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("autorise la réconciliation d'un compte existant sans paiement actif", async () => {
    mocks.getProductContext.mockResolvedValue({
      hasConnectedAccount: true,
      hasReceivable: false,
    });

    await expect(
      beginStripeConnectAction(undefined, new FormData()),
    ).rejects.toThrow("redirect:https://connect.stripe.com/setup/test");
    expect(mocks.ensureAccount).toHaveBeenCalledOnce();
  });

  it("normalise une panne sans exposer le message fournisseur", async () => {
    mocks.ensureAccount.mockRejectedValue(
      new Error("secret Stripe provider response"),
    );

    const result = await beginStripeConnectAction(undefined, new FormData());

    expect(result).toEqual({
      status: "error",
      message:
        "Stripe est temporairement indisponible. Réessayez dans quelques instants.",
    });
    expect(JSON.stringify(result)).not.toContain("provider response");
    expect(mocks.logServerEvent).toHaveBeenCalledWith(
      "warn",
      "stripe.connect.product_start_failed",
      expect.objectContaining({ failureCode: "stripe_unexpected" }),
    );
  });

  it("actualise depuis Stripe sans créer de compte", async () => {
    const result = await refreshStripeConnectAction(
      undefined,
      new FormData(),
    );

    expect(result).toEqual({ status: "success", message: "État Stripe actualisé." });
    expect(mocks.getView).toHaveBeenCalledWith({
      supabaseUser: { kind: "user" },
      supabaseAdmin: { kind: "admin" },
    });
    expect(mocks.ensureAccount).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/app/connexion-stripe",
    );
  });
});
