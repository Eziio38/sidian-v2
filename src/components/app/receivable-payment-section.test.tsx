import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/clients-creances", () => ({
  openPaymentReceivableAction: vi.fn(),
}));

import { ReceivablePaymentSection } from "@/components/app/receivable-payment-section";

const CREANCE_ID = "11111111-1111-4111-8111-111111111111";

describe("ReceivablePaymentSection", () => {
  it("affiche total, réglé et solde restant, arrondis correctement", () => {
    render(
      <ReceivablePaymentSection
        creanceId={CREANCE_ID}
        etat="PARTIELLEMENT_REGLEE"
        montantTotalCents={12000}
        montantRegleCents={5000}
        devise="EUR"
        stripeReadiness={{ configured: true, chargesEnabled: true, onboardingStatus: "paiements_actives" }}
      />,
    );

    expect(screen.getByText("120,00 €")).toBeInTheDocument();
    expect(screen.getByText("50,00 €")).toBeInTheDocument();
    expect(screen.getByText("70,00 €")).toBeInTheDocument();
    expect(screen.getByText("Partiellement réglé")).toBeInTheDocument();
  });

  it("compte Stripe non configuré → message d'alerte, pas 'paiements activés'", () => {
    render(
      <ReceivablePaymentSection
        creanceId={CREANCE_ID}
        etat="OUVERTE"
        montantTotalCents={10000}
        montantRegleCents={0}
        devise="EUR"
        stripeReadiness={{ configured: false, chargesEnabled: false, onboardingStatus: null }}
      />,
    );

    expect(screen.getByText(/Encaissement non configuré/)).toBeInTheDocument();
  });

  it("créance réglée → badge vert, pas de bouton de préparation de lien", () => {
    render(
      <ReceivablePaymentSection
        creanceId={CREANCE_ID}
        etat="REGLEE"
        montantTotalCents={10000}
        montantRegleCents={10000}
        devise="EUR"
        stripeReadiness={{ configured: true, chargesEnabled: true, onboardingStatus: "paiements_actives" }}
      />,
    );

    expect(screen.getByText("Réglé", { selector: "span" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Préparer le lien de paiement" }),
    ).not.toBeInTheDocument();
  });

  it("brouillon avec compte prêt → bouton de préparation de lien visible", () => {
    render(
      <ReceivablePaymentSection
        creanceId={CREANCE_ID}
        etat="BROUILLON"
        montantTotalCents={10000}
        montantRegleCents={0}
        devise="EUR"
        stripeReadiness={{ configured: true, chargesEnabled: true, onboardingStatus: "paiements_actives" }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Préparer le lien de paiement" }),
    ).toBeInTheDocument();
  });
});
