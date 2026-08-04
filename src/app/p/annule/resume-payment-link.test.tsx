import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { PUBLIC_PAYMENT_RESUME_STORAGE_KEY } from "../[token]/pay-button";
import {
  ResumePaymentLink,
  safePublicPaymentResumePath,
} from "./resume-payment-link";

describe("ResumePaymentLink", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("propose uniquement le chemin opaque mémorisé par la page de paiement", async () => {
    const token = "R".repeat(43);
    sessionStorage.setItem(PUBLIC_PAYMENT_RESUME_STORAGE_KEY, `/p/${token}`);

    render(<ResumePaymentLink />);

    const link = await screen.findByRole("link", { name: "Reprendre le paiement" });
    expect(link).toHaveAttribute("href", `/p/${token}`);
  });

  it("refuse tout chemin externe ou identifiant de forme inattendue", async () => {
    sessionStorage.setItem(
      PUBLIC_PAYMENT_RESUME_STORAGE_KEY,
      "https://example.test/paiement",
    );

    render(<ResumePaymentLink />);

    expect(
      await screen.findByText(/ouvrez à nouveau le lien de paiement/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(safePublicPaymentResumePath("/p/trop-court")).toBeNull();
  });
});
