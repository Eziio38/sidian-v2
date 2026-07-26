/**
 * G1-N — normalisation de la sortie LLM validée par schéma.
 * Montants → unités mineures ; dates relatives → ISO via référence ;
 * jamais d’invention ; confiance par champ.
 */

import type {
  DraftFieldName,
  DraftFields,
  OpenAmbiguity,
} from "@/lib/agent/protection-draft";
import {
  canonicalizeDraftEmail,
  normalizeClientName,
  parseAmountEurosToMinor,
  validateAmountMinor,
  validateCurrency,
  validateIsoDate,
} from "@/lib/agent/protection-draft";

import { MIN_FIELD_CONFIDENCE, type LlmStructuredExtractionParsed } from "./schemas";
import { resolveRelativeDate } from "./relative-dates";
import type { NormalizedExtraction } from "./types";

function emailAppearsInMessage(email: string, message: string): boolean {
  return message.toLowerCase().includes(email.toLowerCase());
}

function amountPlausibleInMessage(minor: number, message: string): boolean {
  // Accepte présence du montant euros (avec espaces) ou des centimes bruts.
  const euros = (minor / 100).toFixed(2).replace(/\.00$/, "");
  const eurosAlt = String(minor / 100);
  const compact = euros.replace(".", ",");
  const spaced = euros.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const candidates = [
    String(minor),
    euros,
    eurosAlt,
    compact,
    spaced,
    spaced.replace(".", ","),
    String(Math.round(minor / 100)),
  ];
  const lower = message.toLowerCase();
  return candidates.some((c) => lower.includes(c.toLowerCase()));
}

export function normalizeExtraction(
  parsed: LlmStructuredExtractionParsed,
  input: {
    user_message: string;
    reference_now: string;
    reference_date: string;
  },
): NormalizedExtraction {
  const fields: DraftFields = {};
  const ambiguities: OpenAmbiguity[] = [...(parsed.ambiguities ?? [])];
  const field_confidence: Partial<Record<DraftFieldName, number>> = {};
  const rejected_fields: NormalizedExtraction["rejected_fields"] = [];
  const now = input.reference_now;

  const raw = parsed.fields;

  const tryField = (
    name: DraftFieldName,
    normalize: (value: string | number) => string | number | null,
  ) => {
    const entry = raw[name];
    if (entry == null) return;
    if (entry.confidence < MIN_FIELD_CONFIDENCE) {
      rejected_fields.push({
        field: name,
        reason: "confidence_below_threshold",
      });
      return;
    }
    try {
      const normalized = normalize(entry.value);
      if (normalized === null) {
        rejected_fields.push({ field: name, reason: "normalize_rejected" });
        return;
      }
      fields[name] = {
        value: normalized,
        provenance: "agent_proposed",
        updated_at: now,
      };
      field_confidence[name] = entry.confidence;
    } catch {
      rejected_fields.push({ field: name, reason: "validation_failed" });
    }
  };

  tryField("client_name", (v) => normalizeClientName(String(v)));

  tryField("client_email", (v) => {
    const email = canonicalizeDraftEmail(String(v));
    if (!emailAppearsInMessage(email, input.user_message)) {
      rejected_fields.push({
        field: "client_email",
        reason: "hallucinated_email_not_in_message",
      });
      return null;
    }
    return email;
  });

  tryField("expected_amount_minor", (v) => {
    let minor: number;
    if (typeof v === "number") {
      minor = validateAmountMinor(v);
    } else {
      const trimmed = String(v).trim();
      minor = /^\d+$/.test(trimmed)
        ? validateAmountMinor(Number(trimmed))
        : parseAmountEurosToMinor(trimmed);
    }
    if (!amountPlausibleInMessage(minor, input.user_message)) {
      // Langage familier / TTC : si le message contient un motif monétaire, on accepte.
      const hasMoneyHint =
        /\d/.test(input.user_message) &&
        /(€|eur|euro|montant|facture|ttc|ht|recevoir)/i.test(
          input.user_message,
        );
      if (!hasMoneyHint) {
        rejected_fields.push({
          field: "expected_amount_minor",
          reason: "hallucinated_amount_not_in_message",
        });
        return null;
      }
    }
    return minor;
  });

  tryField("currency", (v) => validateCurrency(String(v)));

  // due_date : ISO ou relative
  const dueEntry = raw.due_date;
  if (dueEntry != null) {
    if (dueEntry.confidence < MIN_FIELD_CONFIDENCE) {
      rejected_fields.push({
        field: "due_date",
        reason: "confidence_below_threshold",
      });
    } else {
      const asString = String(dueEntry.value).trim();
      try {
        if (/^20\d{2}-\d{2}-\d{2}$/.test(asString)) {
          fields.due_date = {
            value: validateIsoDate(asString),
            provenance: "agent_proposed",
            updated_at: now,
          };
          field_confidence.due_date = dueEntry.confidence;
        } else {
          const resolved = resolveRelativeDate(asString, input.reference_date);
          if (resolved.ok) {
            fields.due_date = {
              value: validateIsoDate(resolved.iso),
              provenance: "agent_proposed",
              updated_at: now,
            };
            field_confidence.due_date = dueEntry.confidence;
          } else {
            ambiguities.push(resolved.ambiguity);
          }
        }
      } catch {
        rejected_fields.push({ field: "due_date", reason: "validation_failed" });
      }
    }
  }

  tryField("libelle", (v) => {
    const t = String(v).trim().replace(/\s+/g, " ");
    return t.length > 200 ? t.slice(0, 200) : t;
  });
  tryField("reference_externe", (v) => {
    const t = String(v).trim().replace(/\s+/g, " ");
    return t.length > 200 ? t.slice(0, 200) : t;
  });

  // Devise déduite EUR si montant présent sans currency (règle G1-M MVP)
  if (fields.expected_amount_minor && !fields.currency) {
    const nonEur = /\b(USD|GBP|CHF|\$|£)\b/i.test(input.user_message);
    if (nonEur) {
      ambiguities.push({
        kind: "currency",
        message:
          "Devise non supportée détectée. Sidian MVP accepte uniquement l'EUR.",
        candidates: ["EUR"],
      });
      delete fields.expected_amount_minor;
      delete field_confidence.expected_amount_minor;
    } else {
      fields.currency = {
        value: "EUR",
        provenance: "agent_proposed",
        updated_at: now,
      };
      field_confidence.currency = 0.7;
    }
  }

  // Dédup ambiguïtés
  const seen = new Set<string>();
  const deduped = ambiguities.filter((a) => {
    const k = `${a.kind}:${a.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    fields,
    ambiguities: deduped,
    field_confidence,
    rejected_fields,
    source: "llm",
  };
}
