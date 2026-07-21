import { describe, expect, it, vi } from "vitest";

import { resolveCheckoutReturnStatus } from "@/lib/stripe/checkout/resolve-checkout-status";

function adminWith(result: { data: unknown; error: unknown }) {
  return { rpc: vi.fn(async () => result) } as never;
}

describe("resolveCheckoutReturnStatus", () => {
  it("session_id absent → unknown, sans appel serveur", async () => {
    const rpc = vi.fn();
    const admin = { rpc } as never;
    const status = await resolveCheckoutReturnStatus(admin, null);
    expect(status).toBe("unknown");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("REUSSIE → confirmed", async () => {
    const admin = adminWith({ data: { found: true, etat: "REUSSIE" }, error: null });
    expect(await resolveCheckoutReturnStatus(admin, "cs_test_1")).toBe("confirmed");
  });

  it.each(["CREEE", "NECESSITE_ACTION_CLIENT", "EN_TRAITEMENT"])(
    "%s → processing (paiement encore en cours)",
    async (etat) => {
      const admin = adminWith({ data: { found: true, etat }, error: null });
      expect(await resolveCheckoutReturnStatus(admin, "cs_test_1")).toBe("processing");
    },
  );

  it.each(["ECHOUEE", "ANNULEE"])("%s → not_confirmed", async (etat) => {
    const admin = adminWith({ data: { found: true, etat }, error: null });
    expect(await resolveCheckoutReturnStatus(admin, "cs_test_1")).toBe("not_confirmed");
  });

  it("session inconnue (found=false) → unknown", async () => {
    const admin = adminWith({ data: { found: false }, error: null });
    expect(await resolveCheckoutReturnStatus(admin, "cs_test_1")).toBe("unknown");
  });

  it("erreur serveur → unknown, jamais une exception vers la page publique", async () => {
    const admin = adminWith({ data: null, error: { message: "boom" } });
    expect(await resolveCheckoutReturnStatus(admin, "cs_test_1")).toBe("unknown");
  });
});
