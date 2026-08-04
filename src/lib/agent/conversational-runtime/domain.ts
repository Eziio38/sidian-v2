/**
 * G1-N — validation métier déterministe + missing/ambiguities côté domaine.
 */

import {
  computeMissingFields as draftComputeMissingFields,
  buildTargetedQuestion,
  type DraftFieldName,
  type DraftFields,
  type OpenAmbiguity,
} from "@/lib/agent/protection-draft";

import type { NormalizedExtraction, ValidatedExtraction } from "./types";

export function computeAmbiguities(
  fields: DraftFields,
  incoming: OpenAmbiguity[],
): OpenAmbiguity[] {
  const out = [...incoming];
  // Montant sans devise et sans ambiguïté currency déjà signalée
  if (
    fields.expected_amount_minor &&
    !fields.currency &&
    !out.some((a) => a.kind === "currency")
  ) {
    out.push({
      kind: "currency",
      message: "Devise manquante — confirmez EUR.",
      candidates: ["EUR"],
    });
  }
  return out;
}

/** missing_fields calculé côté domaine — pas uniquement par le modèle. */
export function computeMissingFields(
  fields: DraftFields,
  ambiguities: OpenAmbiguity[],
): DraftFieldName[] {
  return draftComputeMissingFields(fields, ambiguities);
}

export function validateExtraction(
  normalized: NormalizedExtraction,
): ValidatedExtraction {
  const ambiguities = computeAmbiguities(
    normalized.fields,
    normalized.ambiguities,
  );
  // Si une ambiguïté due_date est ouverte, ne pas garder une due_date inventée
  const fields: DraftFields = { ...normalized.fields };
  if (ambiguities.some((a) => a.kind === "due_date")) {
    delete fields.due_date;
  }
  if (ambiguities.some((a) => a.kind === "currency")) {
    delete fields.currency;
  }
  if (ambiguities.some((a) => a.kind === "amount")) {
    delete fields.expected_amount_minor;
  }

  const missing_fields = computeMissingFields(fields, ambiguities);

  return {
    fields,
    ambiguities,
    missing_fields,
    field_confidence: normalized.field_confidence,
    rejected_fields: normalized.rejected_fields,
    source: normalized.source,
  };
}

export function generateNextQuestion(
  extraction: ValidatedExtraction,
): string | null {
  return buildTargetedQuestion(
    extraction.missing_fields,
    extraction.ambiguities,
  );
}

export function generateSummary(extraction: ValidatedExtraction): string {
  const parts: string[] = [];
  const f = extraction.fields;
  if (f.client_name) parts.push(`Client : ${f.client_name.value}`);
  if (f.client_email) parts.push(`E-mail : ${f.client_email.value}`);
  if (f.expected_amount_minor && typeof f.expected_amount_minor.value === "number") {
    const euros = (f.expected_amount_minor.value / 100).toFixed(2);
    parts.push(`Montant : ${euros} ${f.currency?.value ?? "EUR"}`);
  }
  if (f.due_date) parts.push(`Échéance : ${f.due_date.value}`);
  if (f.libelle) parts.push(`Libellé : ${f.libelle.value}`);

  if (parts.length === 0) {
    return "Brouillon encore incomplet — informations insuffisantes.";
  }

  const missing =
    extraction.missing_fields.length > 0
      ? ` Manque : ${extraction.missing_fields.join(", ")}.`
      : " Brouillon prêt pour récapitulatif (confirmation explicite requise).";

  return `Proposition de brouillon — ${parts.join(" · ")}.${missing}`;
}
