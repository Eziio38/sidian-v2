/**
 * G1-N — fallback déterministe (G1-M extractProtectionDraftFromMessage).
 */

import {
  extractProtectionDraftFromMessage,
  type DraftFieldName,
} from "@/lib/agent/protection-draft";

import type { NormalizedExtraction } from "./types";

export function fallbackDeterministicExtraction(
  userMessage: string,
  referenceNow: string,
): NormalizedExtraction {
  const extracted = extractProtectionDraftFromMessage(
    userMessage,
    referenceNow,
  );
  const field_confidence: Partial<Record<DraftFieldName, number>> = {};
  for (const key of Object.keys(extracted.fields) as DraftFieldName[]) {
    if (extracted.fields[key]) {
      field_confidence[key] = 0.85;
    }
  }
  return {
    fields: extracted.fields,
    ambiguities: extracted.ambiguities,
    field_confidence,
    rejected_fields: [],
    source: "deterministic_fallback",
  };
}
