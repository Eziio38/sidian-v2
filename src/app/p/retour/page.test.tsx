import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkoutStatus: vi.fn(),
  authorization: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(async () => ({ rpc: vi.fn() })),
}));
vi.mock("@/lib/stripe/checkout/resolve-checkout-status", () => ({
  resolveCheckoutReturnStatus: mocks.checkoutStatus,
}));
vi.mock("@/lib/stripe/authorizations/create-setup-session", () => ({
  resolveAuthorizationProposalForDisplay: mocks.authorization,
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("@/lib/stripe/checkout/client-ip", () => ({
  clientIpFromHeaders: () => "203.0.113.8",
}));
vi.mock("./authorization-actions", () => ({
  authorizationDecisionAction: vi.fn(),
}));
vi.mock("./recheck-button", () => ({
  RecheckButton: () => <button type="button">Vérifier à nouveau</button>,
}));

const { default: CheckoutReturnPage } = await import("./page");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorization.mockResolvedValue({
    status: "display",
    state: "PROPOSEE",
    prestataireNom: "Atelier Test",
    initialPaymentProcessing: true,
    setupProvisioningStatus: "idle",
  });
});

async function renderPage(status: string) {
  mocks.checkoutStatus.mockResolvedValueOnce(status);
  const view = await CheckoutReturnPage({
    searchParams: Promise.resolve({
      session_id: "cs_payment",
      authorization_token: "A".repeat(43),
    }),
  });
  render(view);
}

describe("CheckoutReturnPage", () => {
  it.each(["unknown", "expired", "not_confirmed"])(
    "statut %s : ne rend jamais la proposition",
    async (status) => {
      await renderPage(status);
      expect(mocks.authorization).not.toHaveBeenCalled();
      expect(
        screen.queryByText(/Configurer avec Stripe/i),
      ).not.toBeInTheDocument();
    },
  );

  it("expired respecte canRecheck=false", async () => {
    await renderPage("expired");
    expect(
      screen.queryByRole("button", { name: /Vérifier à nouveau/i }),
    ).not.toBeInTheDocument();
  });

  it("processing affiche séparément la proposition et le recheck", async () => {
    await renderPage("processing");
    expect(mocks.authorization).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("button", { name: /Configurer avec Stripe/i }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Vérifier à nouveau/i }),
    ).toBeVisible();
  });
});
