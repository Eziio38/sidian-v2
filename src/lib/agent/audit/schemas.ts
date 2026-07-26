/**
 * Schémas Zod stricts de l’Audit Service (G1-E).
 * Tout champ inconnu (payload, secret, token, stack, arguments…) est refusé.
 */

import { z } from "zod";

import {
  actorTypeSchema,
  agentModeSchema,
  autonomyLevelSchema,
  permissionResourceSchema,
} from "@/lib/agent/permissions/request-schema";

import { AUDIT_REASON_CODES } from "./reason-codes";

const nonEmptyString = z.string().min(1);

/** Empreinte hex / opaque — jamais un payload. */
const hashSchema = nonEmptyString.max(128);

export const auditActorSchema = z
  .object({
    actor_id: nonEmptyString,
    actor_type: actorTypeSchema,
  })
  .strict();

export const auditTenantSchema = z
  .object({
    tenant_id: nonEmptyString,
  })
  .strict();

export const auditToolRefSchema = z
  .object({
    tool_id: nonEmptyString.nullable(),
    tool_version: nonEmptyString.nullable(),
  })
  .strict();

export const auditAutonomySchema = z
  .object({
    requested: autonomyLevelSchema.nullable(),
    maximum: autonomyLevelSchema.nullable(),
  })
  .strict();

export const auditDecisionOutcomeSchema = z.enum([
  "allow",
  "deny",
  "require_approval",
  "none",
]);

export const auditResultKindSchema = z.enum([
  "success",
  "denied",
  "approval_required",
  "validation_error",
  "technical_error",
  "business_error",
]);

export const auditExecutionOutcomeSchema = z.enum([
  "not_started",
  "executed",
  "replayed",
  "indeterminate",
]);

export const auditIdempotencyStatusSchema = z.enum([
  "acquired",
  "replay_success",
  "replay_failure",
  "conflict",
  "in_progress",
  "unavailable",
  "completed",
  "failed",
  "completion_failed",
]);

export const auditReasonCodeSchema = z.enum(AUDIT_REASON_CODES);

export const auditResourceSchema = permissionResourceSchema;

/**
 * Entrée build — strict : refuse payload, secrets, stack, arguments, etc.
 */
export const auditBuildInputSchema = z
  .object({
    audit_id: nonEmptyString.optional(),
    correlation_id: nonEmptyString,
    tenant: auditTenantSchema,
    actor: auditActorSchema,
    tool: auditToolRefSchema,
    mode: agentModeSchema.nullable(),
    autonomy: auditAutonomySchema,
    decision: auditDecisionOutcomeSchema,
    result: auditResultKindSchema,
    reason_code: auditReasonCodeSchema,
    duration_ms: z.number().int().nonnegative().finite(),
    resource: auditResourceSchema.optional(),
    params_hash: hashSchema.nullable().optional(),
    executor: nonEmptyString.nullable().optional(),
    output_hash: hashSchema.optional(),
    human_validation_id: nonEmptyString.optional(),
    idempotency_key: nonEmptyString.optional(),
    idempotency_key_hash: hashSchema.optional(),
    idempotency_status: auditIdempotencyStatusSchema.optional(),
    replayed: z.boolean().optional(),
    request_fingerprint: hashSchema.optional(),
    execution_outcome: auditExecutionOutcomeSchema.optional(),
    approval_id: nonEmptyString.optional(),
    approval_status: nonEmptyString.max(64).optional(),
    approval_required: z.boolean().optional(),
    approval_consumed: z.boolean().optional(),
    approval_decision: nonEmptyString.max(64).optional(),
    approval_failure_code: nonEmptyString.max(128).optional(),
  })
  .strict();

export const auditBuildContextSchema = z
  .object({
    now: nonEmptyString,
  })
  .strict();

/**
 * Événement produit — strict, sans champs sensibles.
 */
export const auditEventSchema = z
  .object({
    audit_id: nonEmptyString,
    timestamp: nonEmptyString,
    correlation_id: nonEmptyString,
    tenant: auditTenantSchema,
    actor: auditActorSchema,
    tool: auditToolRefSchema,
    mode: agentModeSchema.nullable(),
    autonomy: auditAutonomySchema,
    decision: auditDecisionOutcomeSchema,
    result: auditResultKindSchema,
    reason_code: auditReasonCodeSchema,
    duration_ms: z.number().int().nonnegative().finite(),
    resource: auditResourceSchema.optional(),
    params_hash: hashSchema.nullable(),
    executor: nonEmptyString.nullable(),
    output_hash: hashSchema.optional(),
    human_validation_id: nonEmptyString.optional(),
    idempotency_key: nonEmptyString.optional(),
    idempotency_key_hash: hashSchema.optional(),
    idempotency_status: auditIdempotencyStatusSchema.optional(),
    replayed: z.boolean().optional(),
    request_fingerprint: hashSchema.optional(),
    execution_outcome: auditExecutionOutcomeSchema.optional(),
    approval_id: nonEmptyString.optional(),
    approval_status: nonEmptyString.max(64).optional(),
    approval_required: z.boolean().optional(),
    approval_consumed: z.boolean().optional(),
    approval_decision: nonEmptyString.max(64).optional(),
    approval_failure_code: nonEmptyString.max(128).optional(),
  })
  .strict();

export type ParsedAuditBuildInput = z.infer<typeof auditBuildInputSchema>;
export type ParsedAuditBuildContext = z.infer<typeof auditBuildContextSchema>;
export type ParsedAuditEvent = z.infer<typeof auditEventSchema>;
