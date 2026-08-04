import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { FollowUpControls } from "@/components/app/follow-up-controls";

const followUp = {
  state: "SUIVI_AMIABLE" as const,
  nextActionAt: "2026-09-01T00:00:00.000Z",
  escalationReason: null,
};

function renderControls(
  updateAction: Parameters<typeof FollowUpControls>[0]["updateAction"],
) {
  return render(
    <FollowUpControls
      receivableId="11111111-1111-4111-8111-111111111111"
      receivableState="OUVERTE"
      followUp={followUp}
      ensureAction={async () => ({ ok: true, message: "ok" })}
      updateAction={updateAction}
    />,
  );
}

describe("FollowUpControls — champs du design system", () => {
  it("expose les trois champs via leur libellé", () => {
    renderControls(async () => ({ ok: true, message: "ok" }));

    expect(screen.getByLabelText("État du suivi")).toBeInTheDocument();
    expect(screen.getByLabelText("Prochaine date d’action")).toBeInTheDocument();
    expect(screen.getByLabelText("Motif facultatif")).toBeInTheDocument();
  });

  it("rend le motif obligatoire et invalide sur erreur de champ", async () => {
    const user = userEvent.setup();
    renderControls(async () => ({
      ok: false,
      message: "Motif manquant.",
      fieldErrors: { escalationReason: ["Le motif est requis."] },
    }));

    await user.selectOptions(
      screen.getByLabelText("État du suivi"),
      "PAUSE_LITIGE",
    );

    const reason = screen.getByLabelText("Motif requis");
    expect(reason).toBeRequired();
    // Renseigné pour franchir la validation native : c'est le rejet serveur
    // qui doit produire l'état invalide accessible.
    await user.type(reason, "Litige en cours");

    await user.click(
      screen.getByRole("button", { name: "Mettre à jour le suivi" }),
    );

    await waitFor(() => {
      const invalid = screen.getByLabelText("Motif requis");
      expect(invalid).toHaveAttribute("aria-invalid", "true");
      expect(invalid.getAttribute("aria-describedby") ?? "").toContain(
        "-error",
      );
    });

    expect(
      screen.getAllByRole("alert").map((node) => node.textContent),
    ).toContain("Le motif est requis.");
  });
});
