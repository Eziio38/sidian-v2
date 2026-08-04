import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { StripeConnectPanel } from "@/components/app/stripe-connect-panel";
import type { StripeConnectAccountView } from "@/lib/stripe/connect/account-view";

const NOT_STARTED: StripeConnectAccountView = {
  configured: false,
  onboardingStatus: "non_commence",
  chargesEnabled: false,
  payoutsEnabled: false,
  cardPaymentsStatus: "inactive",
  sepaDebitPaymentsStatus: "inactive",
  currentlyDueCount: 0,
  pendingVerificationCount: 0,
  pastDueCount: 0,
  canOpenOnboarding: true,
  requiredRailsActive: false,
};

const READY: StripeConnectAccountView = {
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const noopAction = async () => ({
  status: "success" as const,
  message: "État Stripe actualisé.",
});

describe("StripeConnectPanel", () => {
  it("affiche l'état non commencé et bloque les doubles soumissions pendant l'ouverture", async () => {
    const user = userEvent.setup();
    const gate = deferred<{
      status: "error";
      message: string;
    }>();
    const beginAction = vi.fn(async () => gate.promise);

    render(
      <StripeConnectPanel
        view={NOT_STARTED}
        activationContext="ready"
        returnContext={null}
        beginAction={beginAction}
        refreshAction={noopAction}
      />,
    );

    const button = screen.getByRole("button", {
      name: "Finaliser avec Stripe",
    });
    await user.click(button);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Ouverture de Stripe…" }),
      ).toBeDisabled();
    });
    expect(beginAction).toHaveBeenCalledTimes(1);

    gate.resolve({ status: "error", message: "Panne temporaire." });
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Panne temporaire.");
    });
  });

  it("affiche séparément les capacités live sans proposer d'étape inutile", () => {
    render(
      <StripeConnectPanel
        view={READY}
        activationContext="ready"
        returnContext="returned"
        beginAction={noopAction}
        refreshAction={noopAction}
      />,
    );

    expect(screen.getByText("Encaissement prêt")).toBeInTheDocument();
    expect(screen.getByText("Carte bancaire")).toBeInTheDocument();
    expect(screen.getByText("Prélèvement SEPA")).toBeInTheDocument();
    expect(screen.getAllByText("Actif")).toHaveLength(4);
    expect(
      screen.queryByRole("button", { name: /Stripe/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Vérification Stripe effectuée/)).toBeInTheDocument();
  });

  it("ne remplace jamais un état live indisponible par la projection locale", () => {
    render(
      <StripeConnectPanel
        view={null}
        activationContext="unavailable"
        returnContext={null}
        beginAction={noopAction}
        refreshAction={noopAction}
      />,
    );

    expect(screen.getByText("État indisponible")).toBeInTheDocument();
    expect(screen.getByText(/Aucun état local n’est utilisé/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Finaliser avec Stripe" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Actualiser l’état" }),
    ).toBeInTheDocument();
  });

  it("oriente vers le premier paiement sans permettre une création Stripe précoce", () => {
    render(
      <StripeConnectPanel
        view={NOT_STARTED}
        activationContext="missing_receivable"
        returnContext={null}
        beginAction={noopAction}
        refreshAction={noopAction}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Créer un paiement à recevoir" }),
    ).toHaveAttribute("href", "/app/paiements-a-recevoir");
    expect(
      screen.queryByRole("button", { name: "Finaliser avec Stripe" }),
    ).not.toBeInTheDocument();
  });
});
