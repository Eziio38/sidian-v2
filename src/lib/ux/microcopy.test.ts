import { describe, expect, it } from "vitest";

import { AUTO_DEBIT_REGLE_CEILING_PRODUCT_READY } from "@/lib/runtime/payments/constants";
import { UX_COPY, UX_STATUS_LABEL } from "@/lib/ux/microcopy";

describe("config status microcopie", () => {
  it("expose un message clair tant que le plafond auto-débit n’est pas validé", () => {
    expect(AUTO_DEBIT_REGLE_CEILING_PRODUCT_READY).toBe(false);
    expect(UX_COPY.autoDebitCeilingNotValidated.title).toMatch(/plafond/i);
    expect(UX_COPY.autoDebitCeilingNotValidated.description).toMatch(
      /prélèvement automatique/i,
    );
    expect(UX_STATUS_LABEL.blocked).toBe("En pause");
  });

  it("couvre les configs email / WhatsApp / Stripe sans jargon", () => {
    for (const key of [
      "missingConfigEmail",
      "missingConfigWhatsapp",
      "missingConfigStripe",
    ] as const) {
      const copy = UX_COPY[key];
      expect(copy.title.length).toBeGreaterThan(8);
      expect(copy.description.toLowerCase()).not.toMatch(
        /webhook|provider|outbox|rpc|tenant/,
      );
    }
  });
});
