import { describe, expect, it } from "vitest";

import {
  buildWelcomeSituationCopy,
  buildWelcomeSummaryLines,
  resolveWelcomeDataState,
  welcomeSituationHeadline,
} from "./welcome-summary";

describe("buildWelcomeSummaryLines", () => {
  it("résume une journée calme (due_calm)", () => {
    const lines = buildWelcomeSummaryLines({
      todayOutstandingCents: 365_000,
      todayCount: 2,
      overdueCount: 0,
      attentionCount: 0,
    });
    expect(
      resolveWelcomeDataState({
        todayOutstandingCents: 365_000,
        todayCount: 2,
        overdueCount: 0,
        attentionCount: 0,
      }),
    ).toBe("due_calm");
    expect(lines[0]).toMatch(/2 paiements seront suivis cette semaine\./);
    expect(lines[0]).toMatch(/Aucune action urgente/);
  });

  it("signale les points d’attention", () => {
    const lines = buildWelcomeSummaryLines({
      todayOutstandingCents: 0,
      todayCount: 0,
      overdueCount: 1,
      attentionCount: 1,
    });
    expect(
      resolveWelcomeDataState({
        todayOutstandingCents: 0,
        todayCount: 0,
        overdueCount: 1,
        attentionCount: 1,
      }),
    ).toBe("needs_attention");
    expect(lines[0]).toMatch(/nécessitent votre attention/);
  });

  it("couvre first_use, none_due et load_error", () => {
    expect(
      buildWelcomeSummaryLines({
        todayOutstandingCents: 0,
        todayCount: 0,
        overdueCount: 0,
        attentionCount: 0,
        isFirstUse: true,
      })[0],
    ).toMatch(/protection/i);
    expect(
      resolveWelcomeDataState({
        todayOutstandingCents: 0,
        todayCount: 0,
        overdueCount: 0,
        attentionCount: 0,
      }),
    ).toBe("none_due");
    expect(
      buildWelcomeSummaryLines({
        todayOutstandingCents: 0,
        todayCount: 0,
        overdueCount: 0,
        attentionCount: 0,
        loadError: true,
      })[0],
    ).toMatch(/démarrer une protection/);
  });
});

describe("buildWelcomeSituationCopy", () => {
  it("compose une phrase contextuelle sans cartes KPI", () => {
    const copy = buildWelcomeSituationCopy({
      dataState: "due_calm",
      summaryLines: [
        "3 paiements seront suivis cette semaine. Aucune action urgente.",
      ],
      briefCards: [
        {
          id: "expected",
          label: "Cette semaine",
          value: "3 650 €",
          hint: "3 paiements suivis",
        },
        { id: "active", label: "À traiter", value: "0" },
      ],
    });
    expect(copy.headline).toBe("Tout est sous contrôle.");
    expect(copy.detail).toMatch(/3 paiements seront suivis cette semaine/);
    expect(copy.detail).toMatch(/Aucune action urgente/);
  });

  it("expose les headlines attendus", () => {
    expect(welcomeSituationHeadline("needs_attention")).toBe(
      "Votre attention est requise.",
    );
    expect(welcomeSituationHeadline("none_due")).toBe(
      "Rien ne nécessite votre intervention.",
    );
  });
});
