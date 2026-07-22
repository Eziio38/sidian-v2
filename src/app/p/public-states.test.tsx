import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import CheckoutCancelPage from "./annule/page";
import PublicPaymentError from "./error";
import PublicPaymentLoading from "./loading";
import PublicPaymentNotFound from "./not-found";

describe("états applicatifs des pages publiques", () => {
  it("l’annulation reste en lecture seule et ne prétend pas connaître le débit", () => {
    render(<CheckoutCancelPage />);

    expect(
      screen.getByRole("heading", { name: "Parcours de paiement quitté" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/ne modifie aucun paiement/i)).toBeInTheDocument();
    expect(screen.queryByText(/aucun montant n’a été débité/i)).not.toBeInTheDocument();
  });

  it("l’état introuvable couvre sans fuite un lien révoqué ou non valable", () => {
    render(<PublicPaymentNotFound />);

    expect(
      screen.getByRole("heading", { name: "Lien de paiement indisponible" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/creance|payment_link|stripe_/i)).not.toBeInTheDocument();
  });

  it("le chargement est annoncé aux technologies d’assistance", () => {
    render(<PublicPaymentLoading />);

    expect(screen.getByLabelText("Vérification du paiement")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("l’erreur n’expose aucun détail et permet la revérification Next 16", async () => {
    const retry = vi.fn();
    render(
      <PublicPaymentError
        error={new Error("token-secret-interne")}
        unstable_retry={retry}
      />,
    );

    expect(screen.queryByText("token-secret-interne")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
