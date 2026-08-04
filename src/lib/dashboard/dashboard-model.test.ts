import { describe, expect, it } from "vitest";

import {
  buildDashboardModel,
  type DashboardApprovalSource,
  type DashboardAttemptSource,
  type DashboardCaseSource,
  type DashboardClientSource,
  type DashboardModelInput,
  type DashboardPaymentSource,
  type DashboardReceivableSource,
} from "@/lib/dashboard/dashboard-model";

const TODAY = "2026-07-21";
const NOW = "2026-07-21T10:00:00.000Z";

function receivable(
  overrides: Partial<DashboardReceivableSource> & { id: string },
): DashboardReceivableSource {
  return {
    id: overrides.id,
    client_payeur_id: overrides.client_payeur_id ?? "client-1",
    montant: overrides.montant ?? 10_000,
    devise: overrides.devise ?? "EUR",
    date_echeance: overrides.date_echeance ?? "2026-07-25",
    etat: overrides.etat ?? "OUVERTE",
    libelle: overrides.libelle ?? "Accompagnement mensuel",
    archived_at: overrides.archived_at ?? null,
    created_at: overrides.created_at ?? "2026-07-01T09:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-07-01T09:00:00.000Z",
  };
}

function payment(
  overrides: Partial<DashboardPaymentSource> & {
    id: string;
    creance_id: string;
  },
): DashboardPaymentSource {
  return {
    id: overrides.id,
    creance_id: overrides.creance_id,
    montant: overrides.montant ?? 2_500,
    source: overrides.source ?? "lien_agent",
    created_at: overrides.created_at ?? "2026-07-20T09:00:00.000Z",
  };
}

function attempt(
  overrides: Partial<DashboardAttemptSource> & {
    id: string;
    creance_id: string;
  },
): DashboardAttemptSource {
  return {
    id: overrides.id,
    creance_id: overrides.creance_id,
    montant: overrides.montant ?? 7_500,
    etat: overrides.etat ?? "EN_TRAITEMENT",
    created_at: overrides.created_at ?? "2026-07-21T08:00:00.000Z",
  };
}

function approval(
  overrides: Partial<DashboardApprovalSource> & { id: string },
): DashboardApprovalSource {
  return {
    id: overrides.id,
    creance_id: overrides.creance_id ?? null,
    type: overrides.type ?? "rule_change",
    status: overrides.status ?? "pending",
    created_at: overrides.created_at ?? "2026-07-20T08:00:00.000Z",
    decided_at: overrides.decided_at ?? null,
    expires_at: overrides.expires_at ?? "2026-07-22T08:00:00.000Z",
  };
}

function dossier(
  overrides: Partial<DashboardCaseSource> & {
    id: string;
    creance_id: string;
  },
): DashboardCaseSource {
  return {
    id: overrides.id,
    creance_id: overrides.creance_id,
    etat: overrides.etat ?? "ATTENTE_PRESTATAIRE",
    escalation_reason: overrides.escalation_reason ?? null,
    updated_at: overrides.updated_at ?? "2026-07-20T07:00:00.000Z",
  };
}

const clients: DashboardClientSource[] = [
  { id: "client-1", nom: "Atelier Nova" },
];

function input(
  overrides: Partial<Omit<DashboardModelInput, "today" | "now">>,
): DashboardModelInput {
  return {
    today: TODAY,
    now: NOW,
    receivables: overrides.receivables ?? [],
    payments: overrides.payments ?? [],
    attempts: overrides.attempts ?? [],
    approvals: overrides.approvals ?? [],
    cases: overrides.cases ?? [],
    clients: overrides.clients ?? clients,
  };
}

describe("buildDashboardModel", () => {
  it("sépare strictement le solde, les paiements confirmés et les tentatives en traitement", () => {
    const dashboard = buildDashboardModel(
      input({
        receivables: [
          receivable({ id: "receivable-open", montant: 10_000 }),
          receivable({
            id: "receivable-paid",
            montant: 5_000,
            etat: "REGLEE",
          }),
        ],
        payments: [
          payment({
            id: "payment-partial",
            creance_id: "receivable-open",
            montant: 2_500,
          }),
          payment({
            id: "payment-full",
            creance_id: "receivable-paid",
            montant: 5_000,
          }),
        ],
        attempts: [
          attempt({
            id: "attempt-processing",
            creance_id: "receivable-open",
            montant: 7_500,
          }),
        ],
      }),
    );

    expect(dashboard.totals.receivableCents).toBe(7_500);
    expect(dashboard.totals.confirmedCents).toBe(7_500);
    expect(dashboard.totals.processingCents).toBe(7_500);
    expect(dashboard.totals.processingCount).toBe(1);
    expect(dashboard.deadlines[0]).toMatchObject({
      confirmedCents: 2_500,
      outstandingCents: 7_500,
      processingCents: 7_500,
    });
  });

  it("agrège uniquement les états financiers actifs et garde les litiges hors des retards", () => {
    const dashboard = buildDashboardModel(
      input({
        receivables: [
          receivable({
            id: "open-overdue",
            montant: 10_000,
            date_echeance: "2026-07-20",
          }),
          receivable({
            id: "partial-today",
            montant: 8_000,
            etat: "PARTIELLEMENT_REGLEE",
            date_echeance: TODAY,
          }),
          receivable({
            id: "disputed",
            montant: 6_000,
            etat: "EN_LITIGE",
            date_echeance: "2026-07-19",
          }),
          receivable({ id: "draft", montant: 7_000, etat: "BROUILLON" }),
          receivable({ id: "paid", montant: 9_000, etat: "REGLEE" }),
          receivable({ id: "cancelled", etat: "ANNULEE" }),
          receivable({ id: "lost", etat: "IRRECOUVRABLE" }),
          receivable({
            id: "archived",
            etat: "OUVERTE",
            archived_at: "2026-07-18T10:00:00.000Z",
          }),
        ],
        payments: [
          payment({
            id: "partial-payment",
            creance_id: "partial-today",
            montant: 3_000,
          }),
        ],
      }),
    );

    expect(dashboard.totals).toMatchObject({
      receivableCents: 21_000,
      overdueCents: 10_000,
      overdueCount: 1,
      disputedCents: 6_000,
    });
    expect(dashboard.portfolio).toMatchObject({
      activeCount: 3,
      draftCount: 1,
      disputeCount: 1,
      nextDueDate: TODAY,
      nextDueCents: 5_000,
      nextDueCount: 1,
    });
    expect(dashboard.deadlines.map((item) => item.status)).toEqual([
      "disputed",
      "overdue",
      "today",
    ]);
  });

  it("construit des actions humaines durables sans dupliquer un même signal opérationnel", () => {
    const dashboard = buildDashboardModel(
      input({
        receivables: [
          receivable({ id: "awaiting-provider" }),
          receivable({ id: "failed" }),
          receivable({ id: "disputed", etat: "EN_LITIGE" }),
        ],
        attempts: [
          attempt({
            id: "failed-old",
            creance_id: "awaiting-provider",
            etat: "ECHOUEE",
            created_at: "2026-07-20T08:00:00.000Z",
          }),
          attempt({
            id: "processing-new",
            creance_id: "awaiting-provider",
            etat: "EN_TRAITEMENT",
            created_at: "2026-07-21T08:00:00.000Z",
          }),
          attempt({
            id: "failed-current",
            creance_id: "failed",
            etat: "ECHOUEE",
          }),
        ],
        approvals: [
          approval({
            id: "approval-active",
            creance_id: "failed",
            type: "formal_action",
          }),
          approval({
            id: "approval-expired-but-pending",
            creance_id: "failed",
            expires_at: "2026-07-21T09:00:00.000Z",
          }),
        ],
        cases: [
          dossier({
            id: "case-waiting",
            creance_id: "awaiting-provider",
          }),
          dossier({
            id: "case-dispute",
            creance_id: "disputed",
            etat: "ESCALADE_HUMAINE",
          }),
        ],
      }),
    );

    expect(dashboard.actions).toHaveLength(4);
    expect(dashboard.actions.map((action) => action.title)).toEqual(
      expect.arrayContaining([
        "Valider une action formelle",
        "Litige à examiner",
        "Votre réponse est attendue",
        "Paiement échoué à reprendre",
      ]),
    );
    expect(
      dashboard.actions.filter(
        (action) => action.receivableId === "disputed",
      ),
    ).toHaveLength(1);
    expect(
      dashboard.actions.some(
        (action) => action.id === "approval:approval-expired-but-pending",
      ),
    ).toBe(false);
  });

  it("ordonne les événements récents et ne duplique pas un succès de tentative déjà confirmé", () => {
    const dashboard = buildDashboardModel(
      input({
        receivables: [receivable({ id: "receivable" })],
        payments: [
          payment({
            id: "confirmed",
            creance_id: "receivable",
            created_at: "2026-07-21T09:00:00.000Z",
          }),
        ],
        attempts: [
          attempt({
            id: "succeeded",
            creance_id: "receivable",
            etat: "REUSSIE",
            created_at: "2026-07-21T09:00:00.000Z",
          }),
          attempt({
            id: "processing",
            creance_id: "receivable",
            etat: "EN_TRAITEMENT",
            created_at: "2026-07-21T09:30:00.000Z",
          }),
        ],
      }),
    );

    expect(dashboard.events[0].title).toBe("Paiement en traitement");
    expect(
      dashboard.events.filter((event) => event.title === "Paiement confirmé"),
    ).toHaveLength(1);
    expect(
      dashboard.events.some((event) => event.id === "attempt:succeeded"),
    ).toBe(false);
  });

  it("refuse d'agréger une devise hors EUR", () => {
    expect(() =>
      buildDashboardModel(
        input({
          receivables: [
            receivable({ id: "usd", devise: "USD", montant: 10_000 }),
          ],
        }),
      ),
    ).toThrowError("dashboard_unsupported_currency");
  });
});
