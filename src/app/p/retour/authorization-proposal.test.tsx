import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AuthorizationProposal } from "./authorization-proposal";

describe("AuthorizationProposal", () => {
  it("présente le paiement initial processing sans le déclarer confirmé", () => {
    render(
      <AuthorizationProposal
        rawToken={"A".repeat(43)}
        sourceCheckoutSessionId="cs_payment"
        prestataireNom="Atelier Test"
        initialPaymentProcessing
        action={vi.fn(async () => null)}
      />,
    );

    expect(screen.getByText(/toujours en cours de traitement/i)).toBeVisible();
    expect(screen.getByText(/Aucun prélèvement SEPA automatique/i)).toBeVisible();
    expect(screen.queryByText(/paiement confirmé/i)).not.toBeInTheDocument();
  });

  it("transmet une acceptation explicite et versionnée par le texte affiché", async () => {
    const user = userEvent.setup();
    const action = vi.fn(async (previous: unknown, formData: FormData) => {
      void previous;
      void formData;
      return { status: "retry" as const };
    });
    render(
      <AuthorizationProposal
        rawToken={"A".repeat(43)}
        sourceCheckoutSessionId="cs_payment"
        prestataireNom="Atelier Test"
        initialPaymentProcessing={false}
        action={action}
      />,
    );

    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: "Configurer avec Stripe" }),
    );

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    const formData = action.mock.calls[0]?.[1];
    expect(formData).toBeInstanceOf(FormData);
    if (!formData) throw new Error("FormData absent");
    expect(formData.get("consent")).toBe("accepted");
    expect(formData.get("decision")).toBe("accept");
    expect(formData.get("authorization_token")).toBe("A".repeat(43));
    expect(formData.get("source_session_id")).toBe("cs_payment");
  });
});
