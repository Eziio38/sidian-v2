import { describe, expect, it } from "vitest";

import { buildWelcomeSummaryLines } from "./welcome-summary";

describe("buildWelcomeSummaryLines", () => {
  it("résume une journée calme", () => {
    const lines = buildWelcomeSummaryLines({
      todayOutstandingCents: 365_000,
      todayCount: 2,
      overdueCount: 0,
      attentionCount: 0,
    });
    expect(lines[0]).toMatch(/3.?650.?€ sont attendus aujourd’hui\./);
    expect(lines[1]).toBe("Aucun ne nécessite ton intervention.");
  });

  it("signale les points d’attention", () => {
    const lines = buildWelcomeSummaryLines({
      todayOutstandingCents: 0,
      todayCount: 0,
      overdueCount: 1,
      attentionCount: 1,
    });
    expect(lines[0]).toBe("Aucun paiement attendu aujourd’hui.");
    expect(lines[1]).toBe("2 points nécessitent ton attention.");
  });
});
