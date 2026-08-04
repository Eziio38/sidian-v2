import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ProfileForm } from "@/components/app/profile-form";

describe("ProfileForm — restitution de l'erreur du groupe radio", () => {
  it("marque chaque radio invalide et la relie au message", async () => {
    const user = userEvent.setup();
    render(
      <ProfileForm
        action={async () => ({
          ok: false,
          message: "Profil non enregistré.",
          fieldErrors: { profilAgent: ["Choisissez un niveau."] },
        })}
        initial={{ nom: "Agence Test", profilAgent: "controle" }}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Enregistrer le profil" }),
    );

    await waitFor(() => {
      // `aria-invalid` se porte sur le groupe : le rôle `radio` ne le supporte
      // pas (ARIA 1.2).
      expect(screen.getByRole("radiogroup")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    for (const radio of radios) {
      expect(radio.getAttribute("aria-describedby") ?? "").toContain(
        "-profil-error",
      );
    }

    expect(
      screen.getAllByRole("alert").map((node) => node.textContent),
    ).toContain("Choisissez un niveau.");
  });
});
