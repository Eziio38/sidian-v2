import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PayButton } from "./pay-button";
import type { PayActionState } from "./pay-action";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("PayButton — empêche les doubles clics", () => {
  it("désactive le bouton pendant la soumission, jusqu'à résolution du serveur", async () => {
    const user = userEvent.setup();
    const gate = deferred<PayActionState>();
    const action = vi.fn(async (): Promise<PayActionState> => gate.promise);

    render(<PayButton token={"A".repeat(43)} action={action} />);

    const button = screen.getByRole("button", { name: "Régler maintenant" });
    expect(button).not.toBeDisabled();

    await user.click(button);

    await waitFor(() => {
      expect(button).toBeDisabled();
    });
    expect(screen.getByRole("button")).toHaveTextContent("Redirection…");

    // Un second clic pendant que le bouton est désactivé n'invoque jamais
    // une seconde fois l'action serveur — le navigateur ne décide jamais,
    // mais il ne doit même pas pouvoir soumettre une seconde fois.
    await user.click(button);
    expect(action).toHaveBeenCalledTimes(1);

    gate.resolve({ status: "error" });
    await waitFor(() => {
      expect(button).not.toBeDisabled();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Une erreur est survenue. Merci de réessayer plus tard.",
    );
  });

  it("affiche un message précis selon la raison non_payable (paiement en cours)", async () => {
    const action = vi.fn(
      async (): Promise<PayActionState> => ({
        status: "not_payable",
        reason: "pending_payment",
      }),
    );
    const user = userEvent.setup();
    render(<PayButton token={"B".repeat(43)} action={action} />);

    await user.click(screen.getByRole("button", { name: "Régler maintenant" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Un paiement est déjà en cours de traitement",
      );
    });
  });

  it("retombe sur le message générique si la raison n'est pas reconnue", async () => {
    const action = vi.fn(
      async (): Promise<PayActionState> => ({
        status: "not_payable",
        reason: "quelque_chose_d_inconnu",
      }),
    );
    const user = userEvent.setup();
    render(<PayButton token={"C".repeat(43)} action={action} />);

    await user.click(screen.getByRole("button", { name: "Régler maintenant" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Ce paiement n’est pas disponible pour le moment.",
      );
    });
  });
});
