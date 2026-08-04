import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { mapDraftOutputToPanel } from "./map-draft-to-panel";
import { mapBackendStateToPanelStatus, STATUS_LABELS } from "./microcopy";
import { ProtectionPanel } from "./protection-panel";
import { selectProgressiveFields } from "./progressive-fields";
import type { ProtectionDraftToolOutput, ProtectionPanelData } from "./types";

const baseDraftOutput: ProtectionDraftToolOutput = {
  draft_id: "11111111-1111-4111-8111-111111111111",
  state: "INFORMATIONS_MANQUANTES",
  missing_fields: ["due_date"],
  pending_question: "Quelle est la date d’échéance ?",
  open_ambiguities: [],
  recap: {
    client_name: "Dupont Conseil",
    client_email: "jean@dupont.fr",
    expected_amount_minor: 240_000,
    currency: "EUR",
    due_date: null,
    libelle: "Site internet",
    reference_externe: null,
  },
  confirmation_nonce: null,
};

describe("protection panel mapping", () => {
  it("mappe les états backend vers draft/active/blocked", () => {
    expect(mapBackendStateToPanelStatus("TERMINE")).toBe("active");
    expect(mapBackendStateToPanelStatus("ANNULE")).toBe("blocked");
    expect(mapBackendStateToPanelStatus("EXPIRE")).toBe("blocked");
    expect(mapBackendStateToPanelStatus("BROUILLON_COMPLET")).toBe("draft");
  });

  it("formate le récap API sans logique métier", () => {
    const panel = mapDraftOutputToPanel(baseDraftOutput);
    expect(panel.clientName).toBe("Dupont Conseil");
    expect(panel.amountLabel.replace(/\s/g, " ")).toContain("2 400");
    expect(panel.dueDateLabel).toBe("À préciser");
    expect(panel.status).toBe("draft");
    expect(panel.draftId).toBe(baseDraftOutput.draft_id);
    expect(panel.consequenceLabel).toContain("Rien ne sera envoyé");
  });
});

describe("progressive fields", () => {
  it("n’affiche moyen / autorisation / auto-débit qu’une fois enregistrés", () => {
    const partial: ProtectionPanelData = {
      clientName: "Dupont Conseil",
      statusLabel: STATUS_LABELS.draft,
      status: "draft",
      amountLabel: "2 400 €",
      dueDateLabel: "À préciser",
    };
    const ids = selectProgressiveFields(partial).map((f) => f.id);
    expect(ids).toContain("client");
    expect(ids).toContain("amount");
    expect(ids).not.toContain("payment_method");

    const withDue: ProtectionPanelData = {
      ...partial,
      dueDateLabel: "24 août 2026",
    };
    const withDueIds = selectProgressiveFields(withDue).map((f) => f.id);
    expect(withDueIds).toEqual(
      expect.arrayContaining(["client", "amount", "due_date", "status"]),
    );
    expect(withDueIds).not.toContain("payment_method");
    expect(withDueIds).not.toContain("authorization");
    expect(withDueIds).not.toContain("auto_debit");

    const registered: ProtectionPanelData = {
      ...withDue,
      paymentMethodLabel: "Carte bancaire",
      authorizationLabel: "Autorisation SEPA active",
      autoDebitRuleLabel: "Prélèvement activé",
    };
    const registeredIds = selectProgressiveFields(registered).map((f) => f.id);
    expect(registeredIds).toEqual(
      expect.arrayContaining([
        "client",
        "amount",
        "due_date",
        "payment_method",
        "authorization",
        "auto_debit",
        "status",
      ]),
    );
  });
});

describe("ProtectionPanel UI", () => {
  it("ne réserve aucun espace quand fermé", () => {
    const { container } = render(
      <ProtectionPanel
        open={false}
        protection={{
          clientName: "Dupont",
          statusLabel: "Brouillon",
          status: "draft",
          amountLabel: "100 €",
        }}
        onClose={() => undefined}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("affiche les champs progressifs et se ferme facilement", () => {
    const onClose = vi.fn();
    const onPrimary = vi.fn();

    render(
      <ProtectionPanel
        open
        mode="inline"
        protection={{
          clientName: "Dupont Conseil",
          statusLabel: "Brouillon",
          status: "draft",
          amountLabel: "2 400 €",
          dueDateLabel: "24 août 2026",
          nextStepLabel: "Confirmer pour créer",
          consequenceLabel: "Rien n’est créé tant que tu n’as pas confirmé.",
          primaryActionLabel: "Créer la protection",
        }}
        onClose={onClose}
        onPrimaryAction={onPrimary}
      />,
    );

    expect(screen.getByTestId("context-panel")).toBeTruthy();
    expect(screen.getByTestId("protection-field-client").textContent).toContain(
      "Dupont Conseil",
    );
    expect(
      screen.queryByTestId("protection-field-payment_method"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("protection-field-authorization"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("protection-field-auto_debit"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("protection-field-missing"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("protection-field-consequences").textContent,
    ).toContain("Rien n’est créé");
    expect(screen.getByTestId("protection-field-consequences")).toHaveTextContent(
      "Ce que Sidian fera",
    );

    fireEvent.click(screen.getByTestId("context-panel-primary"));
    expect(onPrimary).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("context-panel-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("affiche les tons d’état bloqué et erreur", () => {
    const { rerender } = render(
      <ProtectionPanel
        open
        protection={{
          clientName: "Dupont",
          statusLabel: STATUS_LABELS.blocked,
          status: "blocked",
          amountLabel: "100 €",
          dueDateLabel: "1 janvier 2027",
        }}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByTestId("context-panel").getAttribute("data-status")).toBe(
      "blocked",
    );

    rerender(
      <ProtectionPanel
        open
        protection={{
          clientName: "Dupont",
          statusLabel: STATUS_LABELS.error,
          status: "error",
          amountLabel: "100 €",
          dueDateLabel: "1 janvier 2027",
          primaryActionLabel: "Réessayer",
        }}
        onClose={() => undefined}
        actionError="Une info manque encore."
      />,
    );
    expect(screen.getByTestId("context-panel").getAttribute("data-status")).toBe(
      "error",
    );
    expect(screen.getByTestId("protection-panel-action-error")).toBeTruthy();
  });
});
