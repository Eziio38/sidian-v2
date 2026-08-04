/**
 * G1-N — tests domaine : parse / normalize / validate / fallback / questions.
 */

import { describe, expect, it } from "vitest";

import {
  applyUserCorrection,
  computeMissingFields,
  CONVERSATIONAL_RUNTIME_SCHEMA_VERSION,
  createStubLlmProvider,
  fallbackDeterministicExtraction,
  generateNextQuestion,
  generateSummary,
  llmStructuredExtractionSchema,
  normalizeExtraction,
  parseUserMessage,
  resolveRelativeDate,
  validateExtraction,
} from "@/lib/agent/conversational-runtime";

const NOW = "2026-07-25T12:00:00.000Z";
const REF_DATE = "2026-07-25";

const COMPLETE =
  "Je dois recevoir 2 400 € TTC de Dupont Conseil le 2026-09-12. Contact jean@dupont.fr";

describe("G1-N parseUserMessage / domain", () => {
  it("message complet → champs + montants en unités mineures", async () => {
    const provider = createStubLlmProvider({ mode: "deterministic" });
    const result = await parseUserMessage(provider, {
      user_message: COMPLETE,
      reference_now: NOW,
    });
    expect(result.extraction.fields.expected_amount_minor?.value).toBe(240_000);
    expect(result.extraction.fields.currency?.value).toBe("EUR");
    expect(result.extraction.fields.client_email?.value).toBe("jean@dupont.fr");
    expect(result.extraction.fields.due_date?.value).toBe("2026-09-12");
    expect(result.extraction.missing_fields).toEqual([]);
    expect(result.next_question).toBeNull();
    expect(result.summary).toMatch(/brouillon/i);
  });

  it("message partiel → missing_fields calculés côté domaine", async () => {
    const provider = createStubLlmProvider({ mode: "deterministic" });
    const result = await parseUserMessage(provider, {
      user_message: "Il faudra protéger une facture bientôt.",
      reference_now: NOW,
    });
    expect(result.extraction.missing_fields.length).toBeGreaterThan(0);
    expect(result.next_question).toBeTruthy();
    const domainMissing = computeMissingFields(
      result.extraction.fields,
      result.extraction.ambiguities,
    );
    expect(domainMissing).toEqual(result.extraction.missing_fields);
  });

  it("langage familier + montant espaces/TTC", async () => {
    const provider = createStubLlmProvider({
      mode: "fixed",
      response: {
        schema_version: CONVERSATIONAL_RUNTIME_SCHEMA_VERSION,
        fields: {
          client_name: { value: "Dupont", confidence: 0.88 },
          client_email: { value: "jean@dupont.fr", confidence: 0.95 },
          expected_amount_minor: { value: 240_000, confidence: 0.9 },
          currency: { value: "EUR", confidence: 0.85 },
          due_date: { value: "2026-09-12", confidence: 0.9 },
        },
        ambiguities: [],
      },
    });
    const result = await parseUserMessage(provider, {
      user_message:
        "faut que je récupère genre 2 400 € ttc chez Dupont pour le 2026-09-12, mail jean@dupont.fr",
      reference_now: NOW,
    });
    expect(result.extraction.fields.expected_amount_minor?.value).toBe(240_000);
    expect(result.extraction.source).toBe("llm");
  });

  it("devise absente → déduction EUR (MVP) si montant FR", async () => {
    const provider = createStubLlmProvider({ mode: "deterministic" });
    const result = await parseUserMessage(provider, {
      user_message:
        "Je dois recevoir 1500 de Société Alpha le 2026-10-01. Contact beta@alpha.fr",
      reference_now: NOW,
    });
    if (result.extraction.fields.expected_amount_minor) {
      expect(result.extraction.fields.currency?.value).toBe("EUR");
    }
  });

  it("date relative résolue avec référence explicite", () => {
    const resolved = resolveRelativeDate("dans 15 jours", REF_DATE);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.iso).toBe("2026-08-09");
  });

  it("date ambiguë → question utilisateur (pas d’invention)", async () => {
    const provider = createStubLlmProvider({
      mode: "fixed",
      response: {
        schema_version: CONVERSATIONAL_RUNTIME_SCHEMA_VERSION,
        fields: {
          client_name: { value: "Acme", confidence: 0.9 },
          client_email: { value: "a@b.co", confidence: 0.9 },
          expected_amount_minor: { value: 10000, confidence: 0.9 },
          currency: { value: "EUR", confidence: 0.9 },
          due_date: { value: "bientôt", confidence: 0.9 },
        },
        ambiguities: [],
      },
    });
    const result = await parseUserMessage(provider, {
      user_message:
        "Recevoir 100 € de Acme bientôt. Contact a@b.co",
      reference_now: NOW,
    });
    expect(result.extraction.fields.due_date).toBeUndefined();
    expect(result.extraction.ambiguities.some((a) => a.kind === "due_date")).toBe(
      true,
    );
    expect(result.next_question).toMatch(/échéance|date|ambigu/i);
  });

  it("correction utilisateur écrase le champ", () => {
    const base = validateExtraction(
      fallbackDeterministicExtraction(COMPLETE, NOW),
    );
    const corrected = applyUserCorrection({
      extraction: base,
      field: "client_email",
      value: "autre@dupont.fr",
      now: NOW,
    });
    expect(corrected.fields.client_email?.value).toBe("autre@dupont.fr");
    expect(corrected.fields.client_email?.provenance).toBe("user_corrected");
  });

  it("e-mail invalide rejeté", () => {
    const parsed = llmStructuredExtractionSchema.parse({
      schema_version: CONVERSATIONAL_RUNTIME_SCHEMA_VERSION,
      fields: {
        client_email: { value: "pas-un-email", confidence: 0.99 },
      },
      ambiguities: [],
    });
    const normalized = normalizeExtraction(parsed, {
      user_message: "contact pas-un-email",
      reference_now: NOW,
      reference_date: REF_DATE,
    });
    expect(normalized.fields.client_email).toBeUndefined();
    expect(
      normalized.rejected_fields.some((r) => r.field === "client_email"),
    ).toBe(true);
  });

  it("hallucination e-mail (absent du message) rejetée", () => {
    const parsed = llmStructuredExtractionSchema.parse({
      schema_version: CONVERSATIONAL_RUNTIME_SCHEMA_VERSION,
      fields: {
        client_email: { value: "invente@evil.com", confidence: 0.99 },
        client_name: { value: "Dupont", confidence: 0.9 },
      },
      ambiguities: [],
    });
    const normalized = normalizeExtraction(parsed, {
      user_message: "Facture pour Dupont 100 € le 2026-09-01",
      reference_now: NOW,
      reference_date: REF_DATE,
    });
    expect(normalized.fields.client_email).toBeUndefined();
    expect(
      normalized.rejected_fields.some(
        (r) => r.reason === "hallucinated_email_not_in_message",
      ),
    ).toBe(true);
  });

  it("sortie hors schéma → fallback déterministe", async () => {
    const provider = createStubLlmProvider({
      mode: "fixed",
      response: { nonsense: true, tenant_id: "evil" },
    });
    const result = await parseUserMessage(provider, {
      user_message: COMPLETE,
      reference_now: NOW,
      max_retries: 0,
    });
    expect(result.trace.fallback_used).toBe(true);
    expect(result.extraction.source).toBe("deterministic_fallback");
    expect(result.extraction.fields.expected_amount_minor?.value).toBe(240_000);
  });

  it("timeout provider → fallback", async () => {
    const provider = createStubLlmProvider({
      mode: "timeout",
      delay_ms: 5_000,
    });
    const result = await parseUserMessage(provider, {
      user_message: COMPLETE,
      reference_now: NOW,
      timeout_ms: 50,
      max_retries: 0,
    });
    expect(result.trace.fallback_used).toBe(true);
    expect(result.extraction.fields.client_email?.value).toBe("jean@dupont.fr");
  });

  it("erreur provider + retry puis fallback", async () => {
    const provider = createStubLlmProvider({
      mode: "sequence",
      responses: [],
    });
    provider.setBehavior({
      mode: "error",
      error: new Error("provider_down"),
    });
    const result = await parseUserMessage(provider, {
      user_message: COMPLETE,
      reference_now: NOW,
      max_retries: 1,
    });
    expect(provider.callCount).toBeGreaterThanOrEqual(2);
    expect(result.trace.fallback_used).toBe(true);
  });

  it("generateSummary / generateNextQuestion", () => {
    const empty = validateExtraction(
      fallbackDeterministicExtraction("rien", NOW),
    );
    expect(generateNextQuestion(empty)).toBeTruthy();
    expect(generateSummary(empty)).toMatch(/incomplet/i);
  });
});
