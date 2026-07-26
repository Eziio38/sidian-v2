/**
 * Schémas Zod stricts du modèle d’observabilité (G1-I).
 * Tout champ inconnu (payload, secret, token, stack, arguments…) est refusé.
 */

import { z } from "zod";

import {
  agentModeSchema,
  autonomyLevelSchema,
  resourceKindSchema,
} from "@/lib/agent/permissions/request-schema";

import {
  ALERT_RECOMMENDED_ACTION_CODES,
  OBSERVABILITY_METRIC_NAMES,
  SECURITY_SIGNAL_REASON_CODES,
  SECURITY_SIGNAL_TYPES,
} from "./reason-codes";
import { OBSERVABILITY_SCHEMA_VERSION } from "./types";

const nonEmptyString = z.string().min(1);

/** Empreinte / identifiant opaque — jamais un payload. */
const hashOrIdSchema = nonEmptyString.max(128);

/** Clés de metadata interdites (casse normalisée). */
const FORBIDDEN_METADATA_KEYS = new Set([
  "secret",
  "secrets",
  "token",
  "tokens",
  "access_token",
  "refresh_token",
  "api_key",
  "apikey",
  "authorization",
  "password",
  "passwd",
  "credential",
  "credentials",
  "stack",
  "stack_trace",
  "stacktrace",
  "sql",
  "query",
  "pan",
  "card_number",
  "cardnumber",
  "iban",
  "args",
  "arguments",
  "input_args",
  "output",
  "result_payload",
  "payload",
  "body",
  "idempotency_key",
  "raw_key",
  "owner_token",
  "email",
  "phone",
  "ssn",
  "pii",
]);

function isForbiddenMetadataKey(key: string): boolean {
  const normalized = key.trim().toLowerCase().replace(/-/g, "_");
  if (FORBIDDEN_METADATA_KEYS.has(normalized)) {
    return true;
  }
  return (
    normalized.includes("secret") ||
    normalized.includes("token") ||
    normalized.includes("password") ||
    normalized.includes("stack") ||
    normalized.endsWith("_pan") ||
    normalized.startsWith("pan_")
  );
}

export const observabilityComponentSchema = z.enum([
  "tool_router",
  "permission",
  "idempotency",
  "approval",
  "audit",
  "executor",
  "observability",
]);

export const observabilityOutcomeSchema = z.enum([
  "success",
  "blocked",
  "denied",
  "approval_required",
  "validation_error",
  "error",
  "replayed",
  "degraded",
]);

export const observabilitySeveritySchema = z.enum([
  "info",
  "warning",
  "error",
  "critical",
]);

export const securitySignalTypeSchema = z.enum(SECURITY_SIGNAL_TYPES);

export const securitySignalReasonCodeSchema = z.enum(
  SECURITY_SIGNAL_REASON_CODES,
);

export const alertRecommendedActionCodeSchema = z.enum(
  ALERT_RECOMMENDED_ACTION_CODES,
);

export const observabilityMetricNameSchema = z.enum(OBSERVABILITY_METRIC_NAMES);

/**
 * Metadata sanitizée — scalaires uniquement, clés dangereuses refusées.
 */
export const observabilityMetadataSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .superRefine((record, ctx) => {
    for (const key of Object.keys(record)) {
      if (isForbiddenMetadataKey(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Clé de metadata interdite.",
          path: [key],
        });
      }
    }
  });

export const detectionWindowSchema = z
  .object({
    start: nonEmptyString,
    end: nonEmptyString,
  })
  .strict();

/** Seuils partiels — clés = types de signaux uniquement. */
export const detectorThresholdsSchema = z.partialRecord(
  securitySignalTypeSchema,
  z.number().int().positive().finite(),
);

/**
 * Entrée record / build — strict : refuse payload, secrets, stack, arguments, etc.
 */
export const observabilityRecordInputSchema = z
  .object({
    now: nonEmptyString,
    event_id: hashOrIdSchema.optional(),
    correlation_id: nonEmptyString,
    tenant_id: nonEmptyString,
    component: observabilityComponentSchema,
    operation: nonEmptyString.max(128),
    outcome: observabilityOutcomeSchema,
    severity: observabilitySeveritySchema,
    duration_ms: z.number().int().nonnegative().finite().optional(),
    tool_id: nonEmptyString.max(128).optional(),
    tool_version: nonEmptyString.max(64).optional(),
    mode: agentModeSchema.optional(),
    autonomy_level: autonomyLevelSchema.optional(),
    resource_kind: resourceKindSchema.optional(),
    reason_code: nonEmptyString.max(128).optional(),
    error_code: nonEmptyString.max(128).optional(),
    idempotency_status: nonEmptyString.max(64).optional(),
    approval_status: nonEmptyString.max(64).optional(),
    approval_required: z.boolean().optional(),
    approval_consumed: z.boolean().optional(),
    replayed: z.boolean().optional(),
    execution_outcome: nonEmptyString.max(64).optional(),
    metadata: observabilityMetadataSchema.optional(),
    detection_window: detectionWindowSchema.optional(),
    thresholds: detectorThresholdsSchema.optional(),
  })
  .strict();

/**
 * Événement produit — strict, sans champs sensibles.
 */
export const observabilityEventSchema = z
  .object({
    event_id: hashOrIdSchema,
    schema_version: z.literal(OBSERVABILITY_SCHEMA_VERSION),
    occurred_at: nonEmptyString,
    correlation_id: nonEmptyString,
    tenant_id: nonEmptyString,
    component: observabilityComponentSchema,
    operation: nonEmptyString.max(128),
    outcome: observabilityOutcomeSchema,
    severity: observabilitySeveritySchema,
    duration_ms: z.number().int().nonnegative().finite().optional(),
    tool_id: nonEmptyString.max(128).optional(),
    tool_version: nonEmptyString.max(64).optional(),
    mode: agentModeSchema.optional(),
    autonomy_level: autonomyLevelSchema.optional(),
    resource_kind: resourceKindSchema.optional(),
    reason_code: nonEmptyString.max(128).optional(),
    error_code: nonEmptyString.max(128).optional(),
    idempotency_status: nonEmptyString.max(64).optional(),
    approval_status: nonEmptyString.max(64).optional(),
    approval_required: z.boolean().optional(),
    approval_consumed: z.boolean().optional(),
    replayed: z.boolean().optional(),
    execution_outcome: nonEmptyString.max(64).optional(),
    metadata: observabilityMetadataSchema.optional(),
  })
  .strict();

export const securitySignalSchema = z
  .object({
    signal_id: hashOrIdSchema,
    signal_type: securitySignalTypeSchema,
    tenant_id: nonEmptyString,
    detected_at: nonEmptyString,
    severity: observabilitySeveritySchema,
    reason_code: securitySignalReasonCodeSchema,
    evidence_event_ids: z.array(hashOrIdSchema).min(1),
    window_start: nonEmptyString,
    window_end: nonEmptyString,
    count: z.number().int().positive().finite(),
    threshold: z.number().int().positive().finite().optional(),
  })
  .strict();

export const metricPointSchema = z
  .object({
    name: observabilityMetricNameSchema,
    value: z.number().finite(),
    kind: z.enum(["counter", "histogram"]),
    unit: z.enum(["1", "ms"]),
    occurred_at: nonEmptyString.optional(),
    labels: observabilityMetadataSchema.optional(),
  })
  .strict();

export const alertCandidateSchema = z
  .object({
    alert_candidate_id: hashOrIdSchema,
    tenant_id: nonEmptyString,
    detected_at: nonEmptyString,
    signal_type: securitySignalTypeSchema,
    severity: observabilitySeveritySchema,
    reason_code: securitySignalReasonCodeSchema,
    evidence_event_ids: z.array(hashOrIdSchema).min(1),
    recommended_action_code: alertRecommendedActionCodeSchema,
    deduplication_key: nonEmptyString.max(256),
    window_start: nonEmptyString,
    window_end: nonEmptyString,
  })
  .strict();

export type ParsedObservabilityRecordInput = z.infer<
  typeof observabilityRecordInputSchema
>;
export type ParsedObservabilityEvent = z.infer<typeof observabilityEventSchema>;
export type ParsedSecuritySignal = z.infer<typeof securitySignalSchema>;
export type ParsedMetricPoint = z.infer<typeof metricPointSchema>;
export type ParsedAlertCandidate = z.infer<typeof alertCandidateSchema>;
