import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PaymentReconciliationButton } from "./payment-reconciliation-button";

describe("commande UI de réconciliation", () => {
  it("n’expose que l’UUID métier et aucun identifiant Stripe", () => {
    const receivableId = "11111111-1111-4111-8111-111111111111";
    const { container } = render(
      <PaymentReconciliationButton
        receivableId={receivableId}
        action={vi.fn(async () => ({
          ok: true as const,
          status: "up_to_date" as const,
          message: "À jour.",
        }))}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Vérifier avec Stripe" }),
    ).toBeInTheDocument();
    expect(container.querySelector('input[name="receivableId"]')).toHaveValue(
      receivableId,
    );
    expect(container.innerHTML).not.toMatch(/(?:acct_|cs_|pi_|cus_)/);
  });
});

