/**
 * Schémas Zod stricts du Human Approval Service (G1-H).
 * Refuse secrets, stack, tokens bruts, ToolDefinition et champs inconnus.
 */

import { z } from "zod";

import {
  agentModeSchema,
  actorTypeSchema,
  autonomyLevelSchema,
  permissionResourceSchema,
} from "@/lib/agent/permissions/request-schema";

import {
  APPROVAL_DECISIONS,
  APPROVAL_MAX_TTL_SECONDS,
  APPROVAL_MIN_TTL_SECONDS,
  APPROVAL_SQL_CONSUME_RESULTS,
  APPROVAL_STATUSES,
} from "./types";

const nonEmptyString = z.string().min(1);

/** Empreinte / hash opaque — jamais un payload métier. */
const hashSchema = nonEmptyString.max(128);

const isoTimestampSchema = nonEmptyString.max(64);

export const approvalActorSchema = z
  .object({
    actor_id: nonEmptyString.max(256),
    actor_type: actorTypeSchema,
  })
  .strict();

export const approvalResourceSchema = permissionResourceSchema;

export const approvalRequestInputSchema = z
  .object({
    tenant_id: z.string().uuid(),
    request_fingerprint: hashSchema,
    params_hash: hashSchema,
    tool_id: nonEmptyString.max(128),
    tool_version: nonEmptyString.max(64),
    mode: agentModeSchema,
    requested_autonomy_level: autonomyLevelSchema,
    resource: approvalResourceSchema.optional(),
    requester_actor: approvalActorSchema,
    now: isoTimestampSchema,
    expires_at: isoTimestampSchema.optional(),
    ttl_seconds: z
      .number()
      .int()
      .finite()
      .min(APPROVAL_MIN_TTL_SECONDS)
      .max(APPROVAL_MAX_TTL_SECONDS)
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.expires_at !== undefined && value.ttl_seconds !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "expires_at_and_ttl_seconds_ambiguous",
        path: ["expires_at"],
      });
    }
    if (value.expires_at === undefined && value.ttl_seconds === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "expires_at_or_ttl_seconds_required",
        path: ["expires_at"],
      });
    }
  });

export const approvalDecisionInputSchema = z
  .object({
    approval_id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    decision: z.enum(APPROVAL_DECISIONS),
    decided_by_actor_id: nonEmptyString.max(256),
    reason_code: nonEmptyString.max(128),
    now: isoTimestampSchema,
  })
  .strict();

export const approvalInspectionInputSchema = z
  .object({
    approval_id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    now: isoTimestampSchema,
  })
  .strict();

export const approvalConsumptionInputSchema = z
  .object({
    approval_id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    request_fingerprint: hashSchema,
    params_hash: hashSchema,
    tool_id: nonEmptyString.max(128),
    tool_version: nonEmptyString.max(64),
    mode: agentModeSchema,
    requested_autonomy_level: autonomyLevelSchema,
    resource: approvalResourceSchema.optional(),
    correlation_id: nonEmptyString.max(256),
    /** Hash opaque — longueur alignée contrainte SQL (32–128). */
    idempotency_key_hash: nonEmptyString.min(32).max(128),
    now: isoTimestampSchema,
  })
  .strict();

/** Réponse JSON attendue de `create_human_approval`. */
export const approvalSqlCreateResponseSchema = z
  .object({
    ok: z.boolean(),
    result: z.string().optional(),
    approval_id: z.string().uuid(),
    status: z.literal("pending"),
    requested_at: z.union([z.string(), z.number()]),
    expires_at: z.union([z.string(), z.number()]),
  })
  .passthrough();

/** Réponse JSON attendue de `decide_human_approval` (succès ou échec métier). */
export const approvalSqlDecideResponseSchema = z
  .object({
    ok: z.boolean(),
    result: z.string(),
    approval_id: z.string().uuid().optional().nullable(),
    status: z.string().optional().nullable(),
    decided_at: z.union([z.string(), z.number()]).optional().nullable(),
    decided_by_actor_id: z.string().optional().nullable(),
    decision_reason_code: z.string().optional().nullable(),
    expires_at: z.union([z.string(), z.number()]).optional().nullable(),
  })
  .passthrough();

/** Payload ligne sérialisé par `agent_human_approval_row_payload`. */
export const approvalSqlRowPayloadSchema = z
  .object({
    approval_id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    status: z.enum(APPROVAL_STATUSES),
    request_fingerprint: nonEmptyString,
    params_hash: nonEmptyString,
    tool_id: nonEmptyString,
    tool_version: nonEmptyString,
    mode: agentModeSchema,
    requested_autonomy_level: autonomyLevelSchema,
    resource_kind: z.string().nullable().optional(),
    resource_id: z.string().nullable().optional(),
    requester_actor_id: z.string().optional().nullable(),
    requester_actor_type: z.string().optional().nullable(),
    requested_at: z.union([z.string(), z.number()]),
    expires_at: z.union([z.string(), z.number()]),
    decided_at: z.union([z.string(), z.number()]).nullable().optional(),
    decided_by_actor_id: z.string().nullable().optional(),
    decision_reason_code: z.string().nullable().optional(),
    consumed_at: z.union([z.string(), z.number()]).nullable().optional(),
    consumed_by_correlation_id: z.string().nullable().optional(),
    consumed_idempotency_key_hash: z.string().nullable().optional(),
  })
  .passthrough();

/** Réponse JSON attendue de `get_human_approval_status`. */
export const approvalSqlStatusResponseSchema = z
  .object({
    ok: z.boolean(),
    result: z.string(),
    approval: approvalSqlRowPayloadSchema.optional().nullable(),
  })
  .passthrough();

/** Réponse JSON attendue de `consume_human_approval`. */
export const approvalSqlConsumeResponseSchema = z
  .object({
    ok: z.boolean().optional(),
    result: z.enum(APPROVAL_SQL_CONSUME_RESULTS),
    approval_id: z.string().uuid().optional().nullable(),
    status: z.enum(APPROVAL_STATUSES).optional().nullable(),
    consumed_at: z.union([z.string(), z.number()]).optional().nullable(),
  })
  .passthrough();

export type ParsedApprovalRequestInput = z.infer<
  typeof approvalRequestInputSchema
>;
export type ParsedApprovalDecisionInput = z.infer<
  typeof approvalDecisionInputSchema
>;
export type ParsedApprovalInspectionInput = z.infer<
  typeof approvalInspectionInputSchema
>;
export type ParsedApprovalConsumptionInput = z.infer<
  typeof approvalConsumptionInputSchema
>;
export type ParsedApprovalSqlCreateResponse = z.infer<
  typeof approvalSqlCreateResponseSchema
>;
export type ParsedApprovalSqlDecideResponse = z.infer<
  typeof approvalSqlDecideResponseSchema
>;
export type ParsedApprovalSqlStatusResponse = z.infer<
  typeof approvalSqlStatusResponseSchema
>;
export type ParsedApprovalSqlConsumeResponse = z.infer<
  typeof approvalSqlConsumeResponseSchema
>;
