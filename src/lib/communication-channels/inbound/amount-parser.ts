/**
 * Parseur déterministe de montants EUR (FR) — aucun LLM.
 * Retourne des centimes entiers.
 */

export type ParseAmountSuccess = {
  ok: true;
  amountCents: number;
};

export type ParseAmountFailure = {
  ok: false;
  reason:
    | "empty"
    | "ambiguous"
    | "negative"
    | "zero"
    | "unsupported_currency"
    | "too_many_decimals"
    | "too_large"
    | "multiple_amounts"
    | "not_a_number";
};

export type ParseAmountResult = ParseAmountSuccess | ParseAmountFailure;

const MAX_CENTS = 100_000_000_00; // 100 M €

/**
 * Accepte : 2400 | 2 400 | 2 400 € | 2400€ | 2.400 | 2 400,50 | 2400.50
 * Refuse négatif, zéro, ambigu, multi-montants, devise non EUR explicite.
 */
export function parseFrenchEuroAmount(raw: string): ParseAmountResult {
  const text = raw.trim();
  if (!text) return { ok: false, reason: "empty" };

  // Plusieurs montants séparés
  if ((text.match(/\d[\d\s.,]*\d|\d/g) ?? []).length > 1) {
    // Heuristique : si plusieurs clusters numériques distincts
    const clusters = text.match(/\d[\d\s.,]*/g) ?? [];
    if (clusters.length > 1) {
      return { ok: false, reason: "multiple_amounts" };
    }
  }

  const lower = text.toLowerCase();
  if (
    /\$|usd|gbp|£|chf|yen|¥/.test(lower) ||
    (/\b[a-z]{3}\b/.test(lower) && !/\beur\b/.test(lower) && !/€/.test(text))
  ) {
    // Devise explicite non EUR
    if (/\$|usd|gbp|£|chf|yen|¥/.test(lower)) {
      return { ok: false, reason: "unsupported_currency" };
    }
  }

  // Retirer symbole € / mot eur
  let cleaned = text
    .replace(/\beur\b/gi, "")
    .replace(/€/g, "")
    .trim();

  if (/[a-zA-Z]/.test(cleaned)) {
    return { ok: false, reason: "ambiguous" };
  }

  cleaned = cleaned.replace(/\s+/g, "");

  if (!cleaned) return { ok: false, reason: "empty" };
  if (cleaned.startsWith("-")) return { ok: false, reason: "negative" };
  if (!/^[\d.,]+$/.test(cleaned)) return { ok: false, reason: "not_a_number" };

  const comma = cleaned.includes(",");
  const dot = cleaned.includes(".");

  let normalized: string;
  if (comma && dot) {
    // 1.234,56 → FR
    if (cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")) {
      normalized = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      // 1,234.56 → US-like dans texte FR → ambigu
      return { ok: false, reason: "ambiguous" };
    }
  } else if (comma) {
    const parts = cleaned.split(",");
    if (parts.length === 2 && parts[1].length <= 2) {
      normalized = `${parts[0].replace(/\./g, "")}.${parts[1]}`;
    } else if (parts.length === 2 && parts[1].length === 3 && !parts[0].includes(".")) {
      // 2,400 milliers ambigu avec décimales — en FR 2,400 = 2.400 € souvent milliers
      // Règle : 3 digits après virgule sans autre séparateur → milliers
      normalized = cleaned.replace(",", "");
    } else {
      return { ok: false, reason: "ambiguous" };
    }
  } else if (dot) {
    const parts = cleaned.split(".");
    if (parts.length === 2 && parts[1].length <= 2) {
      normalized = cleaned;
    } else if (parts.length === 2 && parts[1].length === 3) {
      // 2.400 → milliers FR
      normalized = cleaned.replace(/\./g, "");
    } else if (parts.length > 2) {
      // 1.234.567
      normalized = cleaned.replace(/\./g, "");
    } else {
      return { ok: false, reason: "ambiguous" };
    }
  } else {
    normalized = cleaned;
  }

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    if (/^\d+\.\d{3,}$/.test(normalized)) {
      return { ok: false, reason: "too_many_decimals" };
    }
    return { ok: false, reason: "not_a_number" };
  }

  const [whole, frac = ""] = normalized.split(".");
  const cents =
    Number.parseInt(whole, 10) * 100 +
    Number.parseInt((frac + "00").slice(0, 2), 10);

  if (!Number.isFinite(cents)) return { ok: false, reason: "not_a_number" };
  if (cents < 0) return { ok: false, reason: "negative" };
  if (cents === 0) return { ok: false, reason: "zero" };
  if (cents > MAX_CENTS) return { ok: false, reason: "too_large" };

  return { ok: true, amountCents: cents };
}

export function formatEuroFromCents(cents: number): string {
  const euros = Math.floor(cents / 100);
  const rem = cents % 100;
  const whole = euros.toLocaleString("fr-FR");
  if (rem === 0) return `${whole} €`;
  return `${whole},${rem.toString().padStart(2, "0")} €`;
}
