import { z } from "zod";

const nonEmptyString = z.string().min(1);

export const agentModeSchema = z.enum(["agir", "conseiller", "transmettre"]);

export const actorTypeSchema = z.enum(["human", "system"]);

export const autonomyLevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

export const resourceKindSchema = z.enum([
  "invoice",
  "receivable",
  "client",
  "account",
]);

export const permissionGrantSchema = z
  .object({
    permission: nonEmptyString,
    tenant_id: nonEmptyString,
    resource_id: nonEmptyString.optional(),
  })
  .strict();

export const permissionResourceSchema = z
  .object({
    kind: resourceKindSchema,
    resource_id: nonEmptyString,
    tenant_id: nonEmptyString,
  })
  .strict();

export const humanValidationStatusSchema = z.enum([
  "approved",
  "pending",
  "rejected",
  "expired",
]);

export const humanValidationRecordSchema = z
  .object({
    validation_id: nonEmptyString,
    status: humanValidationStatusSchema,
    expires_at: z.string().min(1).optional(),
    bound_tenant_id: nonEmptyString,
    bound_tool_id: nonEmptyString,
    bound_tool_version: nonEmptyString,
    bound_mode: agentModeSchema,
    bound_resource: permissionResourceSchema.optional(),
    bound_params_hash: nonEmptyString,
  })
  .strict();

/**
 * Schéma strict — tout champ inconnu (ex. prompt_says_allowed, llm_says_allowed,
 * claimed_permission, claimed_role) provoque un échec de validation.
 */
export const permissionRequestSchema = z
  .object({
    actor_id: nonEmptyString,
    actor_type: actorTypeSchema,
    tenant_id: nonEmptyString,
    correlation_id: nonEmptyString,
    tool_id: nonEmptyString,
    tool_version: nonEmptyString,
    mode: agentModeSchema,
    requested_autonomy_level: autonomyLevelSchema,
    grants: z.array(permissionGrantSchema),
    resource: permissionResourceSchema.optional(),
    human_validation: humanValidationRecordSchema.optional(),
    current_params_hash: nonEmptyString.optional(),
  })
  .strict();

export const permissionEvaluationContextSchema = z
  .object({
    now: nonEmptyString,
  })
  .strict();

export type ParsedPermissionRequest = z.infer<typeof permissionRequestSchema>;
export type ParsedPermissionEvaluationContext = z.infer<
  typeof permissionEvaluationContextSchema
>;
