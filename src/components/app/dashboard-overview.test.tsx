import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DashboardOverview } from "@/components/app/dashboard-overview";
import { buildDashboardModel } from "@/lib/dashboard/dashboard-model";

describe("DashboardOverview", () => {
  it("rend distinctement solde, confirmé, traitement, échéance et action humaine", () => {
    const dashboard = buildDashboardModel({
      today: "2026-07-21",
      now: "2026-07-21T10:00:00.000Z",
      clients: [{ id: "client-1", nom: "Atelier Nova" }],
      receivables: [
        {
          id: "receivable-1",
          client_payeur_id: "client-1",
          montant: 10_000,
          devise: "EUR",
          date_echeance: "2026-07-20",
          etat: "PARTIELLEMENT_REGLEE",
          libelle: "Accompagnement mensuel",
          archived_at: null,
          created_at: "2026-07-01T09:00:00.000Z",
          updated_at: "2026-07-20T09:00:00.000Z",
        },
      ],
      payments: [
        {
          id: "payment-1",
          creance_id: "receivable-1",
          montant: 2_500,
          source: "lien_agent",
          created_at: "2026-07-20T09:00:00.000Z",
        },
      ],
      attempts: [
        {
          id: "attempt-1",
          creance_id: "receivable-1",
          montant: 7_500,
          etat: "EN_TRAITEMENT",
          created_at: "2026-07-21T09:00:00.000Z",
        },
      ],
      approvals: [
        {
          id: "approval-1",
          creance_id: "receivable-1",
          type: "formal_action",
          status: "pending",
          created_at: "2026-07-21T08:00:00.000Z",
          decided_at: null,
          expires_at: "2026-07-22T08:00:00.000Z",
        },
      ],
      cases: [],
    });

    render(<DashboardOverview dashboard={dashboard} />);

    const summary = screen
      .getByRole("heading", { name: "Synthèse financière" })
      .closest("section");
    expect(summary).not.toBeNull();
    expect(within(summary!).getByText("25,00 €")).toBeInTheDocument();
    expect(within(summary!).getAllByText("75,00 €")).toHaveLength(3);
    expect(screen.getByText("75,00 € en traitement")).toBeInTheDocument();
    expect(screen.getByText("En retard", { selector: "span" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Ouvrir les approbations/ }),
    ).toHaveAttribute("href", "/app/approbations");
    expect(
      screen.getByRole("heading", { name: "Derniers événements" }),
    ).toBeInTheDocument();
  });
});
