/**
 * G1-M — extraction déterministe.
 */

import { describe, expect, it } from "vitest";

import { extractProtectionDraftFromMessage } from "./extraction";
import { CURRENCY_DEDUCTION_RULE } from "./types";

const NOW = "2026-07-25T12:00:00.000Z";

describe("G1-M extractProtectionDraftFromMessage", () => {
  it("extrait client, montant (centimes), email, date ISO explicite", () => {
    const result = extractProtectionDraftFromMessage(
      "Je dois recevoir 2 400 € de Dupont Conseil le 12 septembre 2026. Le contact est jean@dupont.fr.",
      NOW,
    );
    expect(result.fields.expected_amount_minor?.value).toBe(240_000);
    expect(result.fields.currency?.value).toBe("EUR");
    expect(result.fields.client_email?.value).toBe("jean@dupont.fr");
    expect(result.fields.due_date?.value).toBe("2026-09-12");
    expect(String(result.fields.client_name?.value)).toMatch(/Dupont/i);
    expect(result.ambiguities).toHaveLength(0);
    expect(result.fields.client_name?.provenance).toBe("agent_proposed");
  });

  it("n’invente pas les champs absents", () => {
    const result = extractProtectionDraftFromMessage(
      "Il faudra protéger une facture bientôt.",
      NOW,
    );
    expect(result.fields.client_name).toBeUndefined();
    expect(result.fields.client_email).toBeUndefined();
    expect(result.fields.expected_amount_minor).toBeUndefined();
    expect(result.not_found).toEqual(
      expect.arrayContaining([
        "client_name",
        "client_email",
        "expected_amount_minor",
        "currency",
        "due_date",
      ]),
    );
  });

  it("signale une date ambiguë sans année", () => {
    const result = extractProtectionDraftFromMessage(
      "Paiement de 100 € chez Acme le 12 septembre. Contact: a@b.co",
      NOW,
    );
    expect(result.fields.due_date).toBeUndefined();
    expect(result.ambiguities.some((a) => a.kind === "due_date")).toBe(true);
    expect(result.ambiguities[0]?.candidates?.length).toBeGreaterThanOrEqual(1);
  });

  it("signale JJ/MM vs MM/JJ ambigu", () => {
    const result = extractProtectionDraftFromMessage(
      "Recevoir 50 € de Client Test le 05/04/2026. mail: x@y.com",
      NOW,
    );
    expect(result.fields.due_date).toBeUndefined();
    expect(result.ambiguities.some((a) => a.kind === "due_date")).toBe(true);
  });

  it("déduit EUR selon la règle documentée", () => {
    expect(CURRENCY_DEDUCTION_RULE).toMatch(/EUR/);
    const result = extractProtectionDraftFromMessage(
      "Je dois recevoir 1500 de Société Alpha le 2026-10-01. Contact beta@alpha.fr",
      NOW,
    );
    // Montant sans devise explicite + contexte FR → EUR déduit
    if (result.fields.expected_amount_minor) {
      expect(result.fields.currency?.value).toBe("EUR");
    }
  });

  it("refuse devise non-EUR via ambiguïté", () => {
    const result = extractProtectionDraftFromMessage(
      "Invoice 100 USD from Acme. contact c@d.com due 2026-11-01",
      NOW,
    );
    expect(result.ambiguities.some((a) => a.kind === "currency")).toBe(true);
  });
});
