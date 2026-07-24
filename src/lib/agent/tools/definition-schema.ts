import { z } from "zod";

import {
  EFFECT_FAMILIES,
  FORBIDDEN_EFFECT_FAMILIES,
  type EffectFamily,
} from "./effect-family";

export const toolRegistryStatusSchema = z.enum([
  "Draft",
  "Review",
  "Approved",
  "Production",
  "Deprecated",
  "Disabled",
  "Archived",
]);

export type ToolRegistryStatus = z.infer<typeof toolRegistryStatusSchema>;

export const effectFamilySchema = z
  .string()
  .refine((value) => !FORBIDDEN_EFFECT_FAMILIES.includes(value as never), {
    message: "effect_family interdite (décision/arbitrage métier)",
  })
  .refine((value) => (EFFECT_FAMILIES as readonly string[]).includes(value), {
    message: "effect_family hors allowlist",
  })
  .transform((value) => value as EffectFamily);

/**
 * Fiche d’outil — champs obligatoires 06 §12.1 + 08 §7.2.
 * Une seule effect_family (granularité).
 */
export const toolDefinitionSchema = z
  .object({
    tool_id: z.string().min(1),
    name: z.string().min(1),
    version: z.string().min(1),
    description: z.string().min(1),
    category: z.enum([
      "financial",
      "consultation",
      "communication",
      "accounting",
      "workflow",
      "support",
      "other",
    ]),
    operation_type: z.enum(["read", "write"]),
    execution_mode: z.enum(["synchronous", "asynchronous"]),
    owner: z.string().min(1),
    effect_family: effectFamilySchema,
    input_schema_id: z.string().min(1),
    output_schema_id: z.string().min(1),
    permissions: z.object({
      required: z.array(z.string().min(1)).min(1),
      scope: z
        .array(z.enum(["tenant", "account", "invoice", "receivable", "client"]))
        .min(1),
    }),
    autonomy: z.object({
      maximum_level: z.union([
        z.literal(0),
        z.literal(1),
        z.literal(2),
        z.literal(3),
      ]),
      human_validation_required: z.boolean(),
      allowed_modes: z
        .array(z.enum(["agir", "conseiller", "transmettre"]))
        .min(1),
    }),
    risk_level: z.enum(["low", "medium", "high", "critical"]),
    idempotency: z.object({
      required: z.boolean(),
      key_fields: z.array(z.string().min(1)),
      time_window_required: z.boolean(),
      time_window_rationale: z.string().optional(),
    }),
    errors: z
      .array(
        z.object({
          code: z.string().min(1),
          category: z.enum(["technical", "business", "permission"]),
          retryable: z.boolean(),
        }),
      )
      .min(1),
    retry_policy: z.object({
      max_attempts: z.number().int().min(0),
      backoff: z.enum(["none", "fixed", "exponential"]),
      forbidden_when_unknown: z.literal(true),
    }),
    side_effects: z.array(z.string()),
    sensitive_fields: z.array(z.string()),
    logging: z.object({
      correlation_id_required: z.literal(true),
      sensitive_fields_redacted: z.literal(true),
    }),
    timeout_ms: z.number().int().positive(),
    status: toolRegistryStatusSchema,
    deprecation: z
      .object({
        reason: z.string().min(1),
        replacement_tool_id: z.string().optional(),
        replacement_version: z.string().optional(),
        since: z.string().min(1),
      })
      .optional(),
  })
  .superRefine((def, ctx) => {
    if (def.idempotency.required && def.idempotency.key_fields.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["idempotency", "key_fields"],
        message: "idempotency.required exige key_fields non vides",
      });
    }
    if (
      def.operation_type === "write" &&
      def.autonomy.human_validation_required &&
      def.permissions.required.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["permissions", "required"],
        message: "écriture avec validation humaine exige permissions.required",
      });
    }
  });

export type ToolDefinition = z.infer<typeof toolDefinitionSchema>;

export function parseToolDefinition(input: unknown): ToolDefinition {
  return toolDefinitionSchema.parse(input);
}
