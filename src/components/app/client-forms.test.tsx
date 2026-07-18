import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ClientForm } from "@/components/app/client-forms";

type ActionResult =
  | { ok: true }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function creationKeyInput() {
  return screen.getByTestId("client-creation-key") as HTMLInputElement;
}

async function fillFields(
  user: ReturnType<typeof userEvent.setup>,
  values: { nom: string; email: string },
) {
  const nom = screen.getByLabelText("Nom");
  const email = screen.getByLabelText("Email");
  await user.clear(nom);
  await user.type(nom, values.nom);
  await user.clear(email);
  await user.type(email, values.email);
}

describe("ClientForm — création idempotente", () => {
  it("rend le formulaire de création avec une creationKey", () => {
    render(
      <ClientForm
        action={async () => ({ ok: true })}
        submitLabel="Créer le client"
      />,
    );

    expect(screen.getByLabelText("Nom")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
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

    render(<ClientForm action={action} submitLabel="Créer le client" />);

    const keyBeforeError = creationKeyInput().value;

    await fillFields(user, {
      nom: "Client Alpha",
      email: "alpha@example.com",
    });
    await user.click(screen.getByRole("button", { name: "Créer le client" }));

    await waitFor(() => {
      expect(submittedKeys).toHaveLength(1);
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Erreur métier simulée",
      );
    });

    expect(submittedKeys[0]).toBe(keyBeforeError);
    expect(creationKeyInput().value).toBe(keyBeforeError);

    // React 19 réinitialise les inputs non contrôlés après toute action
    // terminée sans throw — re-saisie requise, clé inchangée.
    await fillFields(user, {
      nom: "Client Alpha",
      email: "alpha@example.com",
    });
    await user.click(screen.getByRole("button", { name: "Créer le client" }));

    await waitFor(() => {
      expect(submittedKeys).toHaveLength(2);
      expect(screen.getByText("Enregistré.")).toBeInTheDocument();
    });

    expect(submittedKeys[1]).toBe(keyBeforeError);
    const keyAfterSuccess = creationKeyInput().value;
    expect(keyAfterSuccess).not.toBe(keyBeforeError);
    expect(
      (screen.getByLabelText("Nom") as HTMLInputElement).value,
    ).toBe("");
    expect(
      (screen.getByLabelText("Email") as HTMLInputElement).value,
    ).toBe("");

    await fillFields(user, {
      nom: "Client Beta",
      email: "beta@example.com",
    });
    await user.click(screen.getByRole("button", { name: "Créer le client" }));

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

    render(<ClientForm action={action} submitLabel="Créer le client" />);
    const key0 = creationKeyInput().value;

    await fillFields(user, {
      nom: "Pending Co",
      email: "pending@example.com",
    });
    await user.click(screen.getByRole("button", { name: "Créer le client" }));

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
