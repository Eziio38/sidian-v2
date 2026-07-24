import { z } from "zod";

/**
 * Enveloppe commune d’appel (06 §4.2).
 * human_validation_id appartient ICI uniquement — jamais aux arguments métier.
 */
export const toolCallEnvelopeSchema = z.object({
  tool_id: z.string().min(1),
  tool_version: z.string().min(1),
  correlation_id: z.string().min(1),
  actor_id: z.string().min(1),
  account_id: z.string().min(1),
  object_id: z.string().min(1).optional(),
  mission_id: z.string().min(1).optional(),
  idempotency_key: z.string().min(1).optional(),
  human_validation_id: z.string().min(1).optional(),
  permission_decision_id: z.string().min(1).optional(),
  arguments: z.record(z.string(), z.unknown()),
});

export type ToolCallEnvelope = z.infer<typeof toolCallEnvelopeSchema>;

export const toolOperationStatusSchema = z.enum([
  "success",
  "failure",
  "partial",
  "pending",
  "unknown",
]);

export const toolResultEnvelopeSchema = z.object({
  tool_id: z.string().min(1),
  tool_version: z.string().min(1),
  correlation_id: z.string().min(1),
  operation_status: toolOperationStatusSchema,
  business_status: z.string().optional(),
  error: z
    .object({
      category: z.enum(["technical", "business", "permission"]),
      code: z.string().min(1),
      retryable: z.boolean(),
      message: z.string().min(1),
      user_message: z.string().min(1),
    })
    .optional(),
  data: z.unknown().optional(),
});

export type ToolResultEnvelope = z.infer<typeof toolResultEnvelopeSchema>;
