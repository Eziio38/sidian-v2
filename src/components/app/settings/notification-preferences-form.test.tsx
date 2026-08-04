import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { NotificationPreferencesActionResult } from "@/app/actions/notifications";

import { NotificationPreferencesForm } from "./notification-preferences-form";

describe("NotificationPreferencesForm", () => {
  it("n’affiche que les deux événements réellement émis par le runtime", () => {
    render(
      <NotificationPreferencesForm
        action={async () => ({ ok: true })}
        initial={{ reminderBeforeDue: true, paymentFailed: true }}
      />,
    );

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    expect(screen.getByText("Rappel avant échéance")).toBeInTheDocument();
    expect(screen.getByText("Avis d’échec de paiement")).toBeInTheDocument();
    // Un gabarit jamais émis ne doit jamais apparaître.
    expect(screen.queryByText(/après échéance/i)).not.toBeInTheDocument();
  });

  it("transmet une case décochée comme une désactivation explicite", async () => {
    const user = userEvent.setup();
    const action =
      vi.fn<
        (
          previous: NotificationPreferencesActionResult | undefined,
          formData: FormData,
        ) => Promise<NotificationPreferencesActionResult>
      >(async () => ({ ok: true }));

    render(
      <NotificationPreferencesForm
        action={action}
        initial={{ reminderBeforeDue: true, paymentFailed: true }}
      />,
    );

    await user.click(screen.getAllByRole("checkbox")[0]!);
    await user.click(
      screen.getByRole("button", { name: "Enregistrer les notifications" }),
    );

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const formData = action.mock.calls[0]![1];
    expect(formData.get("reminderBeforeDue")).toBeNull();
    expect(formData.get("paymentFailed")).not.toBeNull();
  });

  it("annonce l’échec dans une région alerte", async () => {
    const user = userEvent.setup();

    render(
      <NotificationPreferencesForm
        action={async () => ({
          ok: false,
          message: "Impossible d’enregistrer tes préférences.",
        })}
        initial={{ reminderBeforeDue: true, paymentFailed: false }}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Enregistrer les notifications" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Impossible d’enregistrer tes préférences.",
      );
    });
  });
});
