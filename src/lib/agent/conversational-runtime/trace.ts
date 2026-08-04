/**
 * G1-N — empreinte message + traces auditables sans données sensibles.
 */

import { createHash } from "node:crypto";

import type { RuntimeTrace, ValidatedExtraction } from "./types";

export function fingerprintMessage(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 32);
}

export function buildRuntimeTrace(input: {
  correlation_id: string;
  provider_id: string;
  source: ValidatedExtraction["source"];
  attempt: number;
  fallback_used: boolean;
  duration_ms: number;
  schema_ok: boolean;
  extraction: ValidatedExtraction;
  message: string;
  error_code?: string;
}): RuntimeTrace {
  return {
    correlation_id: input.correlation_id,
    provider_id: input.provider_id,
    source: input.source,
    attempt: input.attempt,
    fallback_used: input.fallback_used,
    duration_ms: input.duration_ms,
    schema_ok: input.schema_ok,
    rejected_field_count: input.extraction.rejected_fields.length,
    ambiguity_count: input.extraction.ambiguities.length,
    missing_field_count: input.extraction.missing_fields.length,
    message_fingerprint: fingerprintMessage(input.message),
    error_code: input.error_code,
  };
}

/** Jamais de prompt système, JWT, secrets, ni contenu brut utilisateur. */
export function toAuditableTracePayload(trace: RuntimeTrace): Record<string, unknown> {
  return {
    correlation_id: trace.correlation_id,
    provider_id: trace.provider_id,
    source: trace.source,
    attempt: trace.attempt,
    fallback_used: trace.fallback_used,
    duration_ms: trace.duration_ms,
    schema_ok: trace.schema_ok,
    rejected_field_count: trace.rejected_field_count,
    ambiguity_count: trace.ambiguity_count,
    missing_field_count: trace.missing_field_count,
    message_fingerprint: trace.message_fingerprint,
    error_code: trace.error_code ?? null,
  };
}
