import { z } from "zod";

import {
  PERMISSION_ERROR_CODES,
  PERMISSION_REASON_CODES,
} from "./reason-codes";
import { agentModeSchema, autonomyLevelSchema, permissionGrantSchema } from "./request-schema";

export const permissionDecisionOutcomeSchema = z.enum([
  "allow",
  "deny",
  "require_approval",
]);

export const permissionDecisionScopeSchema = z
  .object({
    tenant_id: z.string().min(1),
    resource_id: z.string().min(1).optional(),
  })
  .strict();

export const permissionDecisionAutonomySchema = z
  .object({
    requested: autonomyLevelSchema.nullable(),
    maximum: autonomyLevelSchema.nullable(),
  })
  .strict();

export const permissionDecisionSchema = z
  .object({
    decision: permissionDecisionOutcomeSchema,
    reason_code: z.enum(PERMISSION_REASON_CODES),
    policy_version: z.string().min(1),
    scope: permissionDecisionScopeSchema,
    checks: z.array(z.string()),
    failed_check: z.string().optional(),
    required_permissions: z.array(z.string()),
    matching_grants: z.array(permissionGrantSchema),
    tool_id: z.string().nullable(),
    tool_version: z.string().nullable(),
    mode: agentModeSchema.nullable(),
    autonomy: permissionDecisionAutonomySchema,
    human_validation_required: z.boolean(),
    error_code: z.enum(PERMISSION_ERROR_CODES).optional(),
  })
  .strict();
