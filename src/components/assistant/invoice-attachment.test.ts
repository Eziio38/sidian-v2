import { describe, expect, it } from "vitest";

import {
  buildNonInvoiceAttachmentReply,
  classifyInvoiceAttachment,
  hasInvoiceAttachmentIntent,
  summarizeInvoiceAttachments,
} from "./invoice-attachment";

describe("invoice-attachment", () => {
  it("détecte un PDF comme facture probable", () => {
    expect(
      classifyInvoiceAttachment({
        name: "doc-juillet.pdf",
        type: "application/pdf",
      }),
    ).toBe("likely_invoice");
  });

  it("refuse une capture d’écran", () => {
    expect(
      classifyInvoiceAttachment({
        name: "Capture d’écran 2026-07-27.png",
        type: "image/png",
      }),
    ).toBe("unlikely_invoice");
  });

  it("accepte une image nommée facture", () => {
    expect(
      classifyInvoiceAttachment({
        name: "facture-martin.jpg",
        type: "image/jpeg",
      }),
    ).toBe("likely_invoice");
  });

  it("détecte l’intention facture sans dépendre du seul format PDF", () => {
    expect(
      hasInvoiceAttachmentIntent({
        files: [{ name: "facture-martin.pdf", type: "application/pdf" }],
        instruction: "",
      }),
    ).toBe(true);
    expect(
      hasInvoiceAttachmentIntent({
        files: [{ name: "contrat-martin.pdf", type: "application/pdf" }],
        instruction: "",
      }),
    ).toBe(false);
  });

  it("résume un lot avec au moins un non-facture", () => {
    expect(
      summarizeInvoiceAttachments([
        { name: "facture.pdf", type: "application/pdf" },
        { name: "Capture ecran.png", type: "image/png" },
      ]).verdict,
    ).toBe("unlikely_invoice");
  });

  it("explique clairement qu’une image n’est pas identifiée comme facture", () => {
    const reply = buildNonInvoiceAttachmentReply(["Capture.png"]);
    expect(reply).toMatch(/analyse visuelle sera bientôt disponible/i);
    expect(reply).toMatch(/préparerai la suite/i);
  });

  it("distingue un format non pris en charge", () => {
    const reply = buildNonInvoiceAttachmentReply(
      ["facture.zip"],
      "unsupported",
    );
    expect(reply).toMatch(/format ne peut pas encore être analysé/i);
    expect(reply).toMatch(/indiquer ce que vous souhaitez en faire/i);
  });
});
