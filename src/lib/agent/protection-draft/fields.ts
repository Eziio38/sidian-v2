/**
 * G1-M — fusion de champs, missing fields, questions ciblées, récap.
 */

import type {
  AttachmentMeta,
  DraftFieldName,
  DraftFields,
  DraftFieldValue,
  DraftRecap,
  FieldProvenance,
  OpenAmbiguity,
  ProtectionDraftRecord,
  RequiredDraftField,
} from "./types";
import { REQUIRED_DRAFT_FIELDS } from "./types";
import {
  canonicalizeDraftEmail,
  normalizeClientName,
  parseAmountEurosToMinor,
  validateAmountMinor,
  validateCurrency,
  validateIsoDate,
} from "./validation";

const QUESTIONS: Record<RequiredDraftField, string> = {
  client_name: "Quel est le nom du client ou de la société ?",
  client_email: "Quelle est l’adresse e-mail du contact client ?",
  expected_amount_minor: "Quel montant doit être protégé (en euros) ?",
  currency: "Quelle devise ? (EUR uniquement en MVP)",
  due_date: "Quelle est la date d’échéance (AAAA-MM-JJ) ?",
};

export function computeMissingFields(
  fields: DraftFields,
  ambiguities: OpenAmbiguity[],
): DraftFieldName[] {
  const ambiguousKinds = new Set(ambiguities.map((a) => a.kind));
  const missing: DraftFieldName[] = [];
  for (const key of REQUIRED_DRAFT_FIELDS) {
    if (key === "due_date" && ambiguousKinds.has("due_date")) {
      missing.push("due_date");
      continue;
    }
    if (key === "currency" && ambiguousKinds.has("currency")) {
      missing.push("currency");
      continue;
    }
    if (key === "expected_amount_minor" && ambiguousKinds.has("amount")) {
      missing.push("expected_amount_minor");
      continue;
    }
    if (fields[key] === undefined) {
      missing.push(key);
    }
  }
  return missing;
}

export function buildTargetedQuestion(
  missing: DraftFieldName[],
  ambiguities: OpenAmbiguity[],
): string | null {
  if (ambiguities.length > 0) {
    return ambiguities[0]!.message;
  }
  if (missing.length === 0) return null;
  const first = missing[0]! as RequiredDraftField;
  return QUESTIONS[first] ?? `Précisez : ${first}`;
}

export function mergeFields(
  existing: DraftFields,
  incoming: DraftFields,
  overwriteProvenance: FieldProvenance,
): DraftFields {
  const out: DraftFields = { ...existing };
  for (const [key, value] of Object.entries(incoming) as [
    DraftFieldName,
    DraftFieldValue,
  ][]) {
    if (!value) continue;
    const prev = out[key];
    if (!prev) {
      out[key] = { ...value, provenance: value.provenance };
      continue;
    }
    // Correction / nouvelle valeur écrase proprement
    out[key] = {
      value: value.value,
      provenance: overwriteProvenance,
      updated_at: value.updated_at,
    };
  }
  return out;
}

export function applyCorrection(
  fields: DraftFields,
  fieldName: DraftFieldName,
  rawValue: string | number,
  now: string,
): DraftFields {
  let normalized: string | number;
  switch (fieldName) {
    case "client_name":
      normalized = normalizeClientName(String(rawValue));
      break;
    case "client_email":
      normalized = canonicalizeDraftEmail(String(rawValue));
      break;
    case "expected_amount_minor":
      normalized =
        typeof rawValue === "number"
          ? validateAmountMinor(rawValue)
          : parseAmountEurosToMinor(String(rawValue));
      break;
    case "currency":
      normalized = validateCurrency(String(rawValue));
      break;
    case "due_date":
      normalized = validateIsoDate(String(rawValue));
      break;
    case "libelle":
    case "reference_externe": {
      const t = String(rawValue).trim().replace(/\s+/g, " ");
      normalized = t.length > 200 ? t.slice(0, 200) : t;
      break;
    }
    default:
      normalized = rawValue;
  }
  return {
    ...fields,
    [fieldName]: {
      value: normalized,
      provenance: "user_corrected" as const,
      updated_at: now,
    },
  };
}

export function resolveAmbiguityOnAnswer(
  ambiguities: OpenAmbiguity[],
  answer: string,
  now: string,
): { fields: DraftFields; remaining: OpenAmbiguity[] } {
  const fields: DraftFields = {};
  const remaining: OpenAmbiguity[] = [];
  const trimmed = answer.trim();

  for (const amb of ambiguities) {
    if (amb.kind === "due_date") {
      const candidates = amb.candidates ?? [];
      const hit = candidates.find((c) => c === trimmed || trimmed.includes(c));
      if (hit) {
        fields.due_date = {
          value: validateIsoDate(hit),
          provenance: "user_provided",
          updated_at: now,
        };
        continue;
      }
      // Tentative ISO directe
      try {
        fields.due_date = {
          value: validateIsoDate(trimmed),
          provenance: "user_provided",
          updated_at: now,
        };
        continue;
      } catch {
        remaining.push(amb);
        continue;
      }
    }
    if (amb.kind === "currency") {
      try {
        fields.currency = {
          value: validateCurrency(trimmed),
          provenance: "user_provided",
          updated_at: now,
        };
        continue;
      } catch {
        remaining.push(amb);
        continue;
      }
    }
    if (amb.kind === "amount") {
      try {
        const minor =
          typeof trimmed === "string" && /^\d+$/.test(trimmed)
            ? validateAmountMinor(Number(trimmed))
            : parseAmountEurosToMinor(trimmed);
        fields.expected_amount_minor = {
          value: minor,
          provenance: "user_provided",
          updated_at: now,
        };
        fields.currency = {
          value: "EUR",
          provenance: "user_provided",
          updated_at: now,
        };
        continue;
      } catch {
        remaining.push(amb);
        continue;
      }
    }
    remaining.push(amb);
  }
  return { fields, remaining };
}

export function buildRecap(draft: ProtectionDraftRecord): DraftRecap {
  const f = draft.fields;
  return {
    client_name: (f.client_name?.value as string | undefined) ?? null,
    client_email: (f.client_email?.value as string | undefined) ?? null,
    expected_amount_minor:
      typeof f.expected_amount_minor?.value === "number"
        ? f.expected_amount_minor.value
        : null,
    currency: (f.currency?.value as string | undefined) ?? null,
    due_date: (f.due_date?.value as string | undefined) ?? null,
    libelle: (f.libelle?.value as string | undefined) ?? null,
    reference_externe:
      (f.reference_externe?.value as string | undefined) ?? null,
    field_provenance: f,
    missing_fields: draft.missing_fields,
    open_ambiguities: draft.open_ambiguities,
    attachments: draft.attachments,
  };
}

export function mergeAttachments(
  existing: AttachmentMeta[],
  incoming: AttachmentMeta[] | undefined,
): AttachmentMeta[] {
  if (!incoming || incoming.length === 0) return existing;
  const byId = new Map(existing.map((a) => [a.attachment_id, a]));
  for (const a of incoming) {
    // Métadonnées seules — aucun OCR / contenu
    byId.set(a.attachment_id, {
      filename: a.filename.slice(0, 255),
      content_type: a.content_type.slice(0, 128),
      size_bytes: Math.max(0, Math.min(a.size_bytes, 50_000_000)),
      attachment_id: a.attachment_id.slice(0, 128),
    });
  }
  return [...byId.values()];
}

export function markFieldsConfirmed(
  fields: DraftFields,
  now: string,
): DraftFields {
  const out: DraftFields = {};
  for (const [k, v] of Object.entries(fields) as [
    DraftFieldName,
    DraftFieldValue,
  ][]) {
    if (!v) continue;
    out[k] = { ...v, provenance: "confirmed", updated_at: now };
  }
  return out;
}
