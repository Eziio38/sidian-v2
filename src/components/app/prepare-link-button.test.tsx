import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PrepareLinkResult } from "@/app/actions/clients-creances";

const openPaymentReceivableAction = vi.fn<
  (
    prev: PrepareLinkResult | undefined,
    formData: FormData,
  ) => Promise<PrepareLinkResult>
>();

vi.mock("@/app/actions/clients-creances", () => ({
  get openPaymentReceivableAction() {
    return openPaymentReceivableAction;
  },
}));

const { PrepareLinkButton } = await import(
  "@/components/app/prepare-link-button"
);

describe("PrepareLinkButton — restitution du lien à usage unique", () => {
  it("monte la région live avant l'action et y déplace le focus", async () => {
    const user = userEvent.setup();
    openPaymentReceivableAction.mockResolvedValue({
      ok: true,
      shareUrl: "https://sidian.test/p/abc",
      alreadyPrepared: false,
    });

    render(<PrepareLinkButton creanceId="creance-1" />);

    // La région doit exister avant la mutation, sinon rien n'est annoncé.
    const live = screen
      .getAllByRole("status")
      .find((node) => node.tagName === "DIV");
    expect(live).toBeDefined();
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toBeEmptyDOMElement();

    await user.click(
      screen.getByRole("button", { name: "Préparer le lien de paiement" }),
    );

    await waitFor(() => {
      expect(
        screen.getByLabelText("Lien de paiement à partager"),
      ).toHaveFocus();
    });

    expect(live).toContainElement(
      screen.getByLabelText("Lien de paiement à partager"),
    );
  });
});
