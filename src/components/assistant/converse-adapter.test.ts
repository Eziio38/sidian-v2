import { describe, expect, it } from "vitest";

import {
  buildAssistantMessageFromConfirm,
  buildAssistantMessageFromConverse,
  type ConverseToolOutput,
} from "./converse-adapter";

function output(
  overrides: Partial<ConverseToolOutput> = {},
): ConverseToolOutput {
  return {
    draft_id: "draft-1",
    state: "INFORMATIONS_MANQUANTES",
    summary: "Il manque des informations.",
    missing_fields: ["client_name", "expected_amount_minor", "due_date"],
    confirmation_nonce: null,
    pending_question: "Quel est le client ?",
    open_ambiguities: [],
    recap: {
      client_name: null,
      client_email: null,
      expected_amount_minor: null,
      currency: "EUR",
      due_date: null,
      libelle: null,
      reference_externe: null,
    },
    ...overrides,
  };
}

describe("converse-adapter invoice workflow", () => {
  it("n’affiche pas de carte métier sans donnée fiable", () => {
    const message = buildAssistantMessageFromConverse({
      messageId: "assistant-1",
      output: output(),
    });

    expect(message.card).toBeUndefined();
  });

  it("présente un seul récapitulatif et exige une confirmation explicite", () => {
    const message = buildAssistantMessageFromConverse({
      messageId: "assistant-2",
      output: output({
        state: "RECAPITULATIF",
        missing_fields: [],
        confirmation_nonce: "nonce-confirmation",
        pending_question: null,
        summary: "Protection prête.",
        recap: {
          client_name: "Dupont Conseil",
          client_email: null,
          expected_amount_minor: 120000,
          currency: "EUR",
          due_date: "2026-08-01",
          libelle: "Mission juillet",
          reference_externe: null,
        },
      }),
    });

    expect(message.card?.kind).toBe("protection_draft");
    expect(message.actions).toEqual([
      expect.objectContaining({ kind: "confirm_protection" }),
      expect.objectContaining({ kind: "edit_protection" }),
    ]);
  });

  it("résume le succès dans une carte métier unique avec une seule suite", () => {
    const message = buildAssistantMessageFromConfirm({
      messageId: "assistant-3",
      output: {
        draft_id: "draft-1",
        state: "TERMINE",
        outcome: "created",
        client_payeur_id: "client-1",
        creance_id: "creance-1",
      },
      protection: {
        clientName: "Dupont Conseil",
        amountLabel: "1 200 €",
        dueDateLabel: "1 août 2026",
        status: "draft",
        statusLabel: "Prêt à confirmer",
      },
    });

    expect(message.card).toMatchObject({
      kind: "protection",
      title: "Protection créée",
      statusLabel: "Active",
    });
    expect(message.actions).toHaveLength(1);
    expect(message.actions?.[0]?.kind).toBe("open_protection");
  });
});
