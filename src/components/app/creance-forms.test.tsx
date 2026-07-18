import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { CreanceForm } from "@/components/app/creance-forms";

type ActionResult =
  | { ok: true }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

const clients = [{ id: "11111111-1111-4111-8111-111111111111", nom: "Acme" }];

function creationKeyInput() {
  return screen.getByTestId("paiement-creation-key") as HTMLInputElement;
}

async function fillCreateForm(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText("Client"), clients[0].id);
  const libelle = screen.getByLabelText("Libellé");
  await user.clear(libelle);
  await user.type(libelle, "Facture test");
  fireEvent.change(screen.getByLabelText("Montant (EUR)"), {
    target: { value: "120.00" },
  });
  fireEvent.change(screen.getByLabelText("Date d'échéance"), {
    target: { value: "2026-08-01" },
  });
}

describe("CreanceForm — création idempotente", () => {
  it("rend le formulaire de création avec une creationKey", () => {
    render(
      <CreanceForm
        action={async () => ({ ok: true })}
        clients={clients}
        submitLabel="Créer le paiement"
      />,
    );

    expect(screen.getByLabelText("Client")).toBeInTheDocument();
    expect(creationKeyInput().value).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("conserve la clé sur erreur, la rotate après succès, puis en émet une nouvelle", async () => {
    const user = userEvent.setup();
    const submittedKeys: string[] = [];

    const action = async (
      _prev: ActionResult | undefined,
      formData: FormData,
    ): Promise<ActionResult> => {
      submittedKeys.push(String(formData.get("creationKey") ?? ""));
      if (submittedKeys.length === 1) {
        return { ok: false, message: "Erreur métier simulée" };
      }
      return { ok: true };
    };

    render(
      <CreanceForm
        action={action}
        clients={clients}
        submitLabel="Créer le paiement"
      />,
    );

    const keyBeforeError = creationKeyInput().value;
    await fillCreateForm(user);
    await user.click(
      screen.getByRole("button", { name: "Créer le paiement" }),
    );

    await waitFor(() => {
      expect(submittedKeys).toHaveLength(1);
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Erreur métier simulée",
      );
    });

    expect(submittedKeys[0]).toBe(keyBeforeError);
    expect(creationKeyInput().value).toBe(keyBeforeError);

    await fillCreateForm(user);
    await user.click(
      screen.getByRole("button", { name: "Créer le paiement" }),
    );

    await waitFor(() => {
      expect(submittedKeys).toHaveLength(2);
      expect(screen.getByText("Enregistré.")).toBeInTheDocument();
    });

    expect(submittedKeys[1]).toBe(keyBeforeError);
    const keyAfterSuccess = creationKeyInput().value;
    expect(keyAfterSuccess).not.toBe(keyBeforeError);
    expect(
      (screen.getByLabelText("Montant (EUR)") as HTMLInputElement).value,
    ).toBe("");

    await fillCreateForm(user);
    await user.click(
      screen.getByRole("button", { name: "Créer le paiement" }),
    );

    await waitFor(() => {
      expect(submittedKeys).toHaveLength(3);
    });

    expect(submittedKeys[2]).toBe(keyAfterSuccess);
    expect(submittedKeys[2]).not.toBe(keyBeforeError);
    expect(creationKeyInput().value).not.toBe(keyAfterSuccess);
  });

  it("ne rotate pas la clé pendant pending ni sur erreur", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = false;

    const action = async (): Promise<ActionResult> => {
      entered = true;
      await gate;
      return { ok: false, message: "Toujours en échec" };
    };

    render(
      <CreanceForm
        action={action}
        clients={clients}
        submitLabel="Créer le paiement"
      />,
    );
    const key0 = creationKeyInput().value;

    await fillCreateForm(user);
    await user.click(
      screen.getByRole("button", { name: "Créer le paiement" }),
    );

    await waitFor(() => {
      expect(entered).toBe(true);
    });
    expect(creationKeyInput().value).toBe(key0);
    expect(
      screen.getByRole("button", { name: "Traitement en cours…" }),
    ).toBeDisabled();

    release();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Toujours en échec");
    });
    expect(creationKeyInput().value).toBe(key0);
  });
});
