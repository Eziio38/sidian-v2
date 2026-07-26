/**
 * G1-M — extraction déterministe (brouillon seulement).
 * Pas d’appel LLM ; pas d’écriture Stripe/Supabase métier.
 * Ne jamais inventer une info absente.
 */

import type {
  DraftFieldName,
  DraftFields,
  FieldProvenance,
  OpenAmbiguity,
} from "./types";
import { CURRENCY_DEDUCTION_RULE } from "./types";
import {
  canonicalizeDraftEmail,
  normalizeClientName,
  parseAmountEurosToMinor,
  validateIsoDate,
} from "./validation";

export type ExtractionResult = {
  fields: DraftFields;
  ambiguities: OpenAmbiguity[];
  /** Champs explicitement absents du texte (pas inventés). */
  not_found: DraftFieldName[];
};

const MONTHS_FR: Record<string, number> = {
  janvier: 1,
  janv: 1,
  février: 2,
  fevrier: 2,
  févr: 2,
  fevr: 2,
  mars: 3,
  avril: 4,
  avr: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  juil: 7,
  août: 8,
  aout: 8,
  septembre: 9,
  sept: 9,
  octobre: 10,
  oct: 10,
  novembre: 11,
  nov: 11,
  décembre: 12,
  decembre: 12,
  déc: 12,
  dec: 12,
};

function field(
  value: string | number,
  provenance: FieldProvenance,
  now: string,
): { value: string | number; provenance: FieldProvenance; updated_at: string } {
  return { value, provenance, updated_at: now };
}

function extractEmail(text: string, now: string): DraftFields {
  const match = text.match(
    /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/i,
  );
  if (!match) return {};
  try {
    return {
      client_email: field(canonicalizeDraftEmail(match[0]), "agent_proposed", now),
    };
  } catch {
    return {};
  }
}

function normalizeFrenchAmountToken(whole: string, fraction?: string): string {
  // "2 400" / "2\u00a0400" → "2400" ; fraction "," → "."
  const w = whole.replace(/[ \u00a0]/g, "");
  if (fraction) {
    return `${w}.${fraction.replace(",", "").replace(".", "")}`;
  }
  return w;
}

function extractAmountAndCurrency(
  text: string,
  now: string,
): { fields: DraftFields; ambiguities: OpenAmbiguity[] } {
  const ambiguities: OpenAmbiguity[] = [];
  const fields: DraftFields = {};

  // Priorité : montant + devise explicite (groupes milliers FR).
  const withCurrency =
    /(\d{1,3}(?:[ \u00a0]\d{3})+|\d+)([.,]\d{1,2})?\s*(€|euros?|eur)\b/i.exec(
      text,
    );

  let currencyExplicit = false;
  let rawNumber: string | null = null;

  if (withCurrency) {
    currencyExplicit = true;
    rawNumber = normalizeFrenchAmountToken(
      withCurrency[1],
      withCurrency[2]?.replace(/^[.,]/, ""),
    );
  } else {
    const withContext =
      /(?:recevoir|montant|facture)\s+(\d{1,3}(?:[ \u00a0]\d{3})+|\d+)([.,]\d{1,2})?/i.exec(
        text,
      );
    if (withContext) {
      rawNumber = normalizeFrenchAmountToken(
        withContext[1],
        withContext[2]?.replace(/^[.,]/, ""),
      );
    }
  }

  if (/\b(USD|GBP|CHF|\$|£)\b/i.test(text) && !/€|euros?|\bEUR\b/i.test(text)) {
    ambiguities.push({
      kind: "currency",
      message:
        "Devise non supportée détectée. Sidian MVP accepte uniquement l'EUR.",
      candidates: ["EUR"],
    });
    return { fields, ambiguities };
  }

  if (rawNumber) {
    try {
      const minor = parseAmountEurosToMinor(rawNumber);
      fields.expected_amount_minor = field(minor, "agent_proposed", now);
      // Devise explicite OU déduction EUR (règle documentée MVP FR)
      fields.currency = field("EUR", "agent_proposed", now);
      if (!currencyExplicit) {
        void CURRENCY_DEDUCTION_RULE;
      }
    } catch {
      ambiguities.push({
        kind: "amount",
        message: "Montant illisible — précisez le montant en euros.",
      });
    }
  }

  return { fields, ambiguities };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function extractDueDate(
  text: string,
  now: string,
  referenceNow: Date,
): { fields: DraftFields; ambiguities: OpenAmbiguity[] } {
  const ambiguities: OpenAmbiguity[] = [];
  const fields: DraftFields = {};

  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    try {
      fields.due_date = field(
        validateIsoDate(`${iso[1]}-${iso[2]}-${iso[3]}`),
        "agent_proposed",
        now,
      );
      return { fields, ambiguities };
    } catch {
      /* fallthrough */
    }
  }

  const monthNames = Object.keys(MONTHS_FR).join("|");
  const frLong = new RegExp(
    `\\b(\\d{1,2})\\s+(${monthNames})(?:\\s+(20\\d{2}))?\\b`,
    "i",
  );
  const frMatch = text.match(frLong);
  if (frMatch) {
    const day = Number(frMatch[1]);
    const month = MONTHS_FR[frMatch[2].toLowerCase()];
    const yearExplicit = frMatch[3] ? Number(frMatch[3]) : null;
    if (month && day >= 1 && day <= 31) {
      if (yearExplicit === null) {
        const y = referenceNow.getUTCFullYear();
        const candidateThis = `${y}-${pad2(month)}-${pad2(day)}`;
        const candidateNext = `${y + 1}-${pad2(month)}-${pad2(day)}`;
        ambiguities.push({
          kind: "due_date",
          message: `Date ambiguë (année manquante) : confirmez ${candidateThis} ou ${candidateNext}.`,
          candidates: [candidateThis, candidateNext],
        });
        return { fields, ambiguities };
      }
      try {
        fields.due_date = field(
          validateIsoDate(`${yearExplicit}-${pad2(month)}-${pad2(day)}`),
          "agent_proposed",
          now,
        );
        return { fields, ambiguities };
      } catch {
        ambiguities.push({
          kind: "due_date",
          message: "Date d'échéance invalide — précisez AAAA-MM-JJ.",
        });
        return { fields, ambiguities };
      }
    }
  }

  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const year = slash[3] ? Number(slash[3]) : referenceNow.getUTCFullYear();
    if (a <= 12 && b <= 12 && a !== b) {
      const dmy = `${year}-${pad2(b)}-${pad2(a)}`;
      const mdy = `${year}-${pad2(a)}-${pad2(b)}`;
      ambiguities.push({
        kind: "due_date",
        message: `Date ambiguë (JJ/MM vs MM/JJ) : confirmez ${dmy} ou ${mdy}.`,
        candidates: [dmy, mdy],
      });
      return { fields, ambiguities };
    }
    if (a > 12 && b <= 12) {
      try {
        fields.due_date = field(
          validateIsoDate(`${year}-${pad2(b)}-${pad2(a)}`),
          "agent_proposed",
          now,
        );
      } catch {
        ambiguities.push({
          kind: "due_date",
          message: "Date d'échéance invalide — précisez AAAA-MM-JJ.",
        });
      }
      return { fields, ambiguities };
    }
    if (b > 12 && a <= 12) {
      try {
        fields.due_date = field(
          validateIsoDate(`${year}-${pad2(a)}-${pad2(b)}`),
          "agent_proposed",
          now,
        );
      } catch {
        ambiguities.push({
          kind: "due_date",
          message: "Date d'échéance invalide — précisez AAAA-MM-JJ.",
        });
      }
      return { fields, ambiguities };
    }
    if (!slash[3]) {
      ambiguities.push({
        kind: "due_date",
        message: `Date ambiguë : confirmez ${year}-${pad2(b)}-${pad2(a)} (JJ/MM).`,
        candidates: [`${year}-${pad2(b)}-${pad2(a)}`],
      });
      return { fields, ambiguities };
    }
    try {
      fields.due_date = field(
        validateIsoDate(`${year}-${pad2(b)}-${pad2(a)}`),
        "agent_proposed",
        now,
      );
    } catch {
      ambiguities.push({
        kind: "due_date",
        message: "Date d'échéance invalide — précisez AAAA-MM-JJ.",
      });
    }
  }

  return { fields, ambiguities };
}

function extractClientName(text: string, now: string): DraftFields {
  const patterns = [
    /(?:recevoir|de|chez|client|société|pour)\s+([A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ][\wÀ-ÿ'’&.-]*(?:\s+[A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ][\wÀ-ÿ'’&.-]*){0,4})/,
    /(?:^|\s)([A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ][\wÀ-ÿ'’&.-]+(?:\s+[A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ][\wÀ-ÿ'’&.-]+){0,3})\s+(?:le|pour|montant)/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    let name = m[1].trim();
    if (
      /^(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)$/i.test(
        name,
      )
    ) {
      continue;
    }
    if (name.includes("@")) continue;
    name = name.replace(/\s+le$/i, "").trim();
    try {
      return {
        client_name: field(normalizeClientName(name), "agent_proposed", now),
      };
    } catch {
      /* ignore */
    }
  }
  return {};
}

/**
 * Extrait un brouillon depuis un message naturel.
 * N'invente jamais de champ absent.
 */
export function extractProtectionDraftFromMessage(
  text: string,
  nowIso: string,
): ExtractionResult {
  const nowDate = new Date(nowIso);
  const referenceNow = Number.isNaN(nowDate.getTime()) ? new Date() : nowDate;

  const emailFields = extractEmail(text, nowIso);
  const amount = extractAmountAndCurrency(text, nowIso);
  const date = extractDueDate(text, nowIso, referenceNow);
  const nameFields = extractClientName(text, nowIso);

  const fields: DraftFields = {
    ...nameFields,
    ...emailFields,
    ...amount.fields,
    ...date.fields,
  };

  const ambiguities = [...amount.ambiguities, ...date.ambiguities];

  const required: DraftFieldName[] = [
    "client_name",
    "client_email",
    "expected_amount_minor",
    "currency",
    "due_date",
  ];
  const not_found = required.filter((k) => fields[k] === undefined);

  return { fields, ambiguities, not_found };
}
