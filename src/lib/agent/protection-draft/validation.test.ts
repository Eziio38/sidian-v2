/**
 * G1-M — validation email / montant / date.
 */

import { describe, expect, it } from "vitest";

import { ProtectionDraftError } from "./errors";
import {
  canonicalizeDraftEmail,
  normalizeClientName,
  parseAmountEurosToMinor,
  validateAmountMinor,
  validateCurrency,
  validateIsoDate,
} from "./validation";

describe("G1-M validation", () => {
  it("canonicalise un email valide", () => {
    expect(canonicalizeDraftEmail("  Jean.Dupont@Example.COM ")).toBe(
      "jean.dupont@example.com",
    );
  });

  it("refuse un email invalide", () => {
    expect(() => canonicalizeDraftEmail("pas-un-email")).toThrow(
      ProtectionDraftError,
    );
  });

  it("convertit euros → unités mineures", () => {
    expect(parseAmountEurosToMinor("2400")).toBe(240_000);
    expect(parseAmountEurosToMinor("12,50")).toBe(1_250);
  });

  it("borne les montants", () => {
    expect(() => validateAmountMinor(0)).toThrow(ProtectionDraftError);
    expect(() => validateAmountMinor(100_000_001)).toThrow(ProtectionDraftError);
  });

  it("valide une échéance ISO", () => {
    expect(validateIsoDate("2026-09-12")).toBe("2026-09-12");
    expect(() => validateIsoDate("2026-13-40")).toThrow(ProtectionDraftError);
  });

  it("n’accepte que EUR", () => {
    expect(validateCurrency("eur")).toBe("EUR");
    expect(() => validateCurrency("USD")).toThrow(ProtectionDraftError);
  });

  it("normalise un nom client", () => {
    expect(normalizeClientName("  Dupont   Conseil ")).toBe("Dupont Conseil");
  });
});
