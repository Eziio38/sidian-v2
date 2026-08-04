import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  formatSuggestionAmount,
  formatSuggestionDate,
  MessageSuggestions,
  SUGGESTION_ENTER_EMAIL,
  SUGGESTION_ENTER_PHONE,
  SUGGESTION_OTHER_AMOUNT,
  SUGGESTION_PICK_DATE,
} from "./message-suggestions";

describe("MessageSuggestions", () => {
  it("formate un montant saisi", () => {
    expect(formatSuggestionAmount("1500")).toBe("1 500 €");
    expect(formatSuggestionAmount("1 500,5")).toBe("1 500,5 €");
    expect(formatSuggestionAmount("abc")).toBeNull();
  });

  it("formate une date ISO en français", () => {
    expect(formatSuggestionDate("2026-08-15")).toMatch(/15/);
    expect(formatSuggestionDate("2026-08-15")).toMatch(/2026/);
    expect(formatSuggestionDate("bad")).toBeNull();
  });

  it("transforme « Autre montant » en champ de saisie", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <MessageSuggestions
        suggestions={["1 000 €", "2 500 €", SUGGESTION_OTHER_AMOUNT]}
        onSelect={onSelect}
      />,
    );

    await user.click(screen.getByRole("button", { name: SUGGESTION_OTHER_AMOUNT }));
    expect(screen.getByTestId("suggestion-amount-input")).toBeVisible();
    expect(onSelect).not.toHaveBeenCalled();

    await user.type(screen.getByTestId("suggestion-amount-input"), "1800");
    await user.click(screen.getByTestId("suggestion-amount-submit"));

    expect(onSelect).toHaveBeenCalledWith("1 800 €");
  });

  it("ouvre un datepicker pour « Choisir une date »", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <MessageSuggestions
        suggestions={["Dans 30 jours", "Fin du mois", SUGGESTION_PICK_DATE]}
        onSelect={onSelect}
      />,
    );

    await user.click(screen.getByRole("button", { name: SUGGESTION_PICK_DATE }));
    expect(screen.getByTestId("suggestion-date-picker")).toBeVisible();
    expect(onSelect).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Aujourd’hui" }));
    expect(onSelect).toHaveBeenCalledWith(
      expect.stringMatching(/\d{4}/),
    );
  });

  it("transforme « Créer un client » en saisie du nom", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClientNameSubmit = vi.fn();

    render(
      <MessageSuggestions
        suggestions={["Dupont Conseil", "Créer un client"]}
        onSelect={onSelect}
        onClientNameSubmit={onClientNameSubmit}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Créer un client" }));
    expect(screen.getByTestId("suggestion-client-name-input")).toBeVisible();
    expect(onSelect).not.toHaveBeenCalled();

    await user.type(screen.getByTestId("suggestion-client-name-input"), "Martin");
    await user.click(screen.getByTestId("suggestion-client-name-submit"));
    expect(onClientNameSubmit).toHaveBeenCalledWith("Martin");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("laisse annuler la saisie d’email ouverte automatiquement", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <MessageSuggestions
        suggestions={[SUGGESTION_ENTER_EMAIL]}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByTestId("suggestion-email-input")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Annuler" }));

    expect(screen.queryByTestId("suggestion-email-input")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: SUGGESTION_ENTER_EMAIL }),
    ).toBeVisible();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("rend le focus à la suggestion après annulation d’un éditeur", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <MessageSuggestions
        suggestions={["1 000 €", SUGGESTION_OTHER_AMOUNT]}
        onSelect={onSelect}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: SUGGESTION_OTHER_AMOUNT }),
    );
    await user.click(screen.getByRole("button", { name: "Annuler" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: SUGGESTION_OTHER_AMOUNT }),
      ).toHaveFocus();
    });
  });

  it("réouvre la saisie d’email après un nouveau clic explicite", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <MessageSuggestions
        suggestions={[SUGGESTION_ENTER_EMAIL]}
        onSelect={onSelect}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Annuler" }));
    await user.click(
      screen.getByRole("button", { name: SUGGESTION_ENTER_EMAIL }),
    );

    await user.type(
      screen.getByTestId("suggestion-email-input"),
      "contact@martin.fr",
    );
    await user.click(screen.getByTestId("suggestion-email-submit"));

    expect(onSelect).toHaveBeenCalledWith("contact@martin.fr");
  });

  it("réinitialise l’éditeur automatique quand le jeu de suggestions change", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const view = render(
      <MessageSuggestions
        suggestions={[SUGGESTION_ENTER_EMAIL]}
        onSelect={onSelect}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.queryByTestId("suggestion-email-input")).not.toBeInTheDocument();

    view.rerender(
      <MessageSuggestions
        suggestions={[SUGGESTION_ENTER_PHONE]}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByTestId("suggestion-phone-input")).toBeVisible();
    expect(screen.getByTestId("suggestion-phone-input")).toHaveFocus();
  });
});
