/**
 * Schéma de résultat ToolRouteResult (G1-D).
 * Stable, sans stack ni secrets.
 * Champ `audit` optionnel (G1-E) — structure validée par auditEventSchema.
 * Champs `observability` / `observability_degraded` optionnels (G1-I).
 */

import { z } from "zod";

import { auditEventSchema } from "@/lib/agent/audit";
import { observabilityEventSchema } from "@/lib/agent/observability";

import { ROUTER_ERROR_CODES } from "./error-codes";

export const routerErrorCategorySchema = z.enum([
  "technical",
  "business",
  "permission",
  "validation",
]);

export const toolRouteErrorSchema = z
  .object({
    code: z.enum(ROUTER_ERROR_CODES),
    category: routerErrorCategorySchema,
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const toolRouteSuccessSchema = z
  .object({
    status: z.literal("success"),
    tool_id: z.string().min(1),
    tool_version: z.string().min(1),
    correlation_id: z.string().min(1),
    output: z.unknown(),
    audit: auditEventSchema.optional(),
    observability: observabilityEventSchema.optional(),
    observability_degraded: z.boolean().optional(),
  })
  .strict();

export const toolRouteBlockedSchema = z
  .object({
    status: z.literal("blocked"),
    tool_id: z.string().min(1).optional(),
    tool_version: z.string().min(1).optional(),
    correlation_id: z.string().min(1).optional(),
    error: toolRouteErrorSchema,
    audit: auditEventSchema.optional(),
    observability: observabilityEventSchema.optional(),
    observability_degraded: z.boolean().optional(),
  })
  .strict();

export const toolRouteResultSchema = z.discriminatedUnion("status", [
  toolRouteSuccessSchema,
  toolRouteBlockedSchema,
]);
