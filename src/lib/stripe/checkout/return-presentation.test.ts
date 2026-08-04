import { describe, expect, it } from "vitest";

import { checkoutReturnPresentation } from "./return-presentation";

describe("checkoutReturnPresentation", () => {
  it("ne présente jamais unknown comme un paiement en cours", () => {
    const presentation = checkoutReturnPresentation("unknown");

    expect(presentation.title).toBe("Paiement impossible à vérifier");
    expect(presentation.message).not.toContain("en cours de traitement");
    expect(presentation.canRecheck).toBe(true);
  });

  it("réserve le libellé en cours à la projection processing", () => {
    expect(checkoutReturnPresentation("processing").title).toBe(
      "Paiement en cours",
    );
  });

  it("explique une expiration sans prétendre à un résultat financier", () => {
    const presentation = checkoutReturnPresentation("expired");

    expect(presentation.title).toBe("Session de paiement expirée");
    expect(presentation.message).toContain("sans confirmer de paiement");
    expect(presentation.message).toContain("lien de paiement reste utilisable");
    expect(presentation.canRecheck).toBe(false);
  });
});
