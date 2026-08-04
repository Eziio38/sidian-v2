import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AccountClosureForm } from "./account-closure-form";

const CLOSURE_SUMMARY = [
  "Votre compte est clôturé et vos données personnelles ont été anonymisées.",
  "Vos factures, paiements et clients associés sont conservés : la loi impose de garder les pièces comptables. Le reste de votre compte a été anonymisé.",
];

describe("AccountClosureForm", () => {
  it("relie le refus au champ de confirmation", async () => {
    const user = userEvent.setup();

    render(
      <AccountClosureForm
        accountEmail="pro@sidian.test"
        action={async () => ({
          ok: false,
          message:
            "Saisissez l’adresse email de votre compte pour confirmer la clôture.",
        })}
      />,
    );

    await user.type(
      screen.getByLabelText(/Confirme en saisissant l’adresse/),
      "voisin@sidian.test",
    );
    await user.click(
      screen.getByRole("button", { name: /Clôturer définitivement/ }),
    );

    await waitFor(() => {
      const field = screen.getByLabelText(/Confirme en saisissant l’adresse/);
      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(field.getAttribute("aria-describedby") ?? "").toContain("-error");
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Saisissez l’adresse email de votre compte",
    );
  });

  it("restitue ce qui reste conservé, sans annoncer une suppression totale", async () => {
    const user = userEvent.setup();

    render(
      <AccountClosureForm
        accountEmail="pro@sidian.test"
        action={async () => ({
          ok: true,
          report: {
            prestataireId: "00000000-0000-0000-0000-000000000000",
            alreadyClosed: false,
            closedAt: "2026-08-03T10:00:00.000Z",
            anonymised: {
              profileIdentity: true,
              documentsSoftDeleted: 0,
              messagesErased: 0,
              conversationsCleared: 0,
            },
            retainedForLegalObligation: {
              clients: 3,
              creances: 5,
              payments: 2,
            },
            storageObjectsRemoved: true,
            storageObjectsCount: 0,
            authIdentityRevoked: true,
          },
          summary: CLOSURE_SUMMARY,
        })}
      />,
    );

    await user.type(
      screen.getByLabelText(/Confirme en saisissant l’adresse/),
      "pro@sidian.test",
    );
    await user.click(
      screen.getByRole("button", { name: /Clôturer définitivement/ }),
    );

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "la loi impose de garder les pièces comptables",
      );
    });
    expect(screen.queryByText(/entièrement supprimé/)).not.toBeInTheDocument();
  });
});
