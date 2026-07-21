import { describe, expect, it } from "vitest";

import { buildReceivableTimeline, computeReceivableAmounts } from "./detail-core";

describe("détail d’un paiement à recevoir", () => {
  it("sépare strictement confirmé, en traitement et restant", () => {
    const amounts = computeReceivableAmounts(
      20_000,
      [
        {
          id: "payment",
          montant: 5_000,
          source: "lien_agent",
          created_at: "2026-07-21T10:00:00.000Z",
        },
      ],
      [
        {
          id: "processing",
          montant: 15_000,
          moyen: "sepa_core",
          etat: "EN_TRAITEMENT",
          created_at: "2026-07-21T11:00:00.000Z",
        },
        {
          id: "failed",
          montant: 15_000,
          moyen: "carte",
          etat: "ECHOUEE",
          created_at: "2026-07-21T09:00:00.000Z",
        },
      ],
    );

    expect(amounts).toEqual({
      confirmedCents: 5_000,
      processingCents: 15_000,
      remainingCents: 15_000,
    });
  });

  it("explique qu’un échec ne réduit pas le solde confirmé", () => {
    const events = buildReceivableTimeline(
      [],
      [
        {
          id: "failed",
          montant: 10_000,
          moyen: "carte",
          etat: "ECHOUEE",
          created_at: "2026-07-21T09:00:00.000Z",
        },
      ],
      [],
    );

    expect(events[0].description).toContain("solde confirmé reste inchangé");
    expect(events[0].tone).toBe("danger");
  });
});
