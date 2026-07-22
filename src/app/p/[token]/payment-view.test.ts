import { describe, expect, it } from "vitest";

import { buildPublicPaymentView, formatDueDate } from "./payment-view";

const base = {
  payable: true,
  montant: 25000,
  amountPaid: 5000,
  remaining: 20000,
  prestataireNom: "Agence Exemple",
  libelle: "Accompagnement juillet",
  referenceExterne: "REF-2026-42",
  dateEcheance: "2026-08-15",
  pendingMoyen: null,
  availableRails: ["card", "sepa_core"] as const,
};

describe("buildPublicPaymentView", () => {
  it("présente identité, référence, total, payé, solde, échéance et rails réels", () => {
    const view = buildPublicPaymentView({
      ...base,
      availableRails: [...base.availableRails],
    });

    expect(view).toMatchObject({
      providerName: "Agence Exemple",
      label: "Accompagnement juillet",
      reference: "REF-2026-42",
      dueDate: "15 août 2026",
      total: "250,00 €",
      paid: "50,00 €",
      remaining: "200,00 €",
      statusLabel: "Partiellement réglé",
      railLabels: ["Carte bancaire", "Prélèvement SEPA"],
    });
  });

  it("n’annonce pas le SEPA lorsque seule la carte est active", () => {
    const view = buildPublicPaymentView({
      ...base,
      amountPaid: 0,
      remaining: 25000,
      availableRails: ["card"],
    });

    expect(view.statusLabel).toBe("À régler");
    expect(view.railLabels).toEqual(["Carte bancaire"]);
  });

  it("distingue un prélèvement en traitement d’un paiement confirmé", () => {
    const view = buildPublicPaymentView({
      ...base,
      payable: false,
      reason: "pending_payment",
      pendingMoyen: "sepa_core",
      availableRails: [],
    });

    expect(view.statusLabel).toBe("En cours de traitement");
    expect(view.stateTitle).toBe("Un règlement est en cours");
    expect(view.stateDescription).toContain("attente de confirmation");
    expect(view.stateDescription).not.toContain("confirmé");
  });

  it("rejette silencieusement une date civile invalide", () => {
    expect(formatDueDate("2026-02-31")).toBeNull();
    expect(formatDueDate("15/08/2026")).toBeNull();
  });
});
