/**
 * G1-N — application d’une correction utilisateur (déterministe).
 */

import {
  applyCorrection,
  type DraftFieldName,
  type DraftFields,
} from "@/lib/agent/protection-draft";

import {
  computeMissingFields,
  computeAmbiguities,
  generateNextQuestion,
  generateSummary,
} from "./domain";
import type { ValidatedExtraction } from "./types";

export function applyUserCorrection(input: {
  extraction: ValidatedExtraction;
  field: DraftFieldName;
  value: string | number;
  now: string;
}): ValidatedExtraction {
  const fields = applyCorrection(
    input.extraction.fields as DraftFields,
    input.field,
    input.value,
    input.now,
  );

  let ambiguities = [...input.extraction.ambiguities];
  if (input.field === "due_date") {
    ambiguities = ambiguities.filter((a) => a.kind !== "due_date");
  }
  if (input.field === "currency") {
    ambiguities = ambiguities.filter((a) => a.kind !== "currency");
  }
  if (input.field === "expected_amount_minor") {
    ambiguities = ambiguities.filter((a) => a.kind !== "amount");
  }

  ambiguities = computeAmbiguities(fields, ambiguities);
  const missing_fields = computeMissingFields(fields, ambiguities);
  const field_confidence = {
    ...input.extraction.field_confidence,
    [input.field]: 1,
  };

  return {
    fields,
    ambiguities,
    missing_fields,
    field_confidence,
    rejected_fields: input.extraction.rejected_fields,
    source: input.extraction.source,
  };
}

export function describeAfterCorrection(extraction: ValidatedExtraction): {
  next_question: string | null;
  summary: string;
} {
  return {
    next_question: generateNextQuestion(extraction),
    summary: generateSummary(extraction),
  };
}
