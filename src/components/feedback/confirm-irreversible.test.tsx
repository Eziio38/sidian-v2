import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfirmIrreversible } from "./confirm-irreversible";

describe("ConfirmIrreversible — clavier et focus", () => {
  it("donne le focus au bouton de confirmation à l’ouverture", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmIrreversible
        title="Supprimer le dossier"
        description="Cette action ne peut pas être annulée."
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        onConfirm={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Supprimer" }));

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Supprimer" })).toHaveFocus(),
    );
  });

  it("expose un titre de niveau 2 comme nom accessible", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmIrreversible
        title="Supprimer le dossier"
        description="Cette action ne peut pas être annulée."
        confirmLabel="Supprimer"
        onConfirm={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Supprimer" }));

    expect(
      screen.getByRole("heading", { level: 2, name: "Supprimer le dossier" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toHaveAccessibleName(
      "Supprimer le dossier",
    );
    expect(screen.getByRole("alertdialog")).toHaveAccessibleDescription(
      "Cette action ne peut pas être annulée.",
    );
  });

  it("ferme avec Échap et rend le focus au déclencheur", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmIrreversible
        title="Supprimer le dossier"
        confirmLabel="Supprimer"
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Supprimer" })).toHaveFocus(),
    );

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Supprimer" })).toHaveFocus();
  });

  it("boucle la tabulation entre confirmation et annulation", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmIrreversible
        title="Supprimer le dossier"
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        onConfirm={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    await screen.findByRole("alertdialog");

    const confirm = screen.getByRole("button", { name: "Supprimer" });
    const cancel = screen.getByRole("button", { name: "Annuler" });
    await waitFor(() => expect(confirm).toHaveFocus());

    await user.tab();
    expect(cancel).toHaveFocus();

    await user.tab();
    expect(confirm).toHaveFocus();

    await user.tab({ shift: true });
    expect(cancel).toHaveFocus();
  });

  it("rend le focus au déclencheur après confirmation", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmIrreversible
        title="Supprimer le dossier"
        confirmLabel="Supprimer"
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    await screen.findByRole("alertdialog");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Supprimer" })).toHaveFocus(),
    );
    await user.click(screen.getByRole("button", { name: "Supprimer" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Supprimer" })).toHaveFocus();
  });

  it("variante formulaire : focus sur la soumission et Échap referme", async () => {
    const user = userEvent.setup();
    const formAction = vi.fn();
    render(
      <ConfirmIrreversible
        title="Annuler le paiement"
        description="Le lien de paiement sera désactivé."
        confirmLabel="Annuler le paiement"
        cancelLabel="Revenir"
        formAction={formAction}
        formChildren={<input type="hidden" name="id" value="rec_1" />}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Annuler le paiement" }),
    );
    await screen.findByRole("alertdialog");

    const submit = screen.getByRole("button", { name: "Annuler le paiement" });
    expect(submit).toHaveAttribute("type", "submit");
    await waitFor(() => expect(submit).toHaveFocus());

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(formAction).not.toHaveBeenCalled();
  });
});
