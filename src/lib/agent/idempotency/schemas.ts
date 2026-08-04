/**
 * Schémas Zod stricts du service d’idempotence (G1-G).
 * Refuse secrets, stack, tokens bruts et champs inconnus.
 */

import { z } from "zod";

import {
  agentModeSchema,
  autonomyLevelSchema,
  permissionResourceSchema,
} from "@/lib/agent/permissions/request-schema";

import {
  IDEMPOTENCY_MAX_TTL_SECONDS,
  IDEMPOTENCY_MIN_TTL_SECONDS,
} from "./types";

const nonEmptyString = z.string().min(1);

/** Empreinte hex / opaque — jamais un payload. */
const hashSchema = nonEmptyString.max(128);

const summaryValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const idempotencyTerminalSuccessSchema = z
  .object({
    status: z.literal("success"),
    output_hash: hashSchema,
    summary: z.record(z.string(), summaryValueSchema).optional(),
  })
  .strict();

export const idempotencyTerminalFailureSchema = z
  .object({
    status: z.literal("failure"),
    failure_code: nonEmptyString.max(128),
    message: nonEmptyString.max(512).optional(),
  })
  .strict();

export const idempotencyTerminalResultSchema = z.discriminatedUnion("status", [
  idempotencyTerminalSuccessSchema,
  idempotencyTerminalFailureSchema,
]);

export const idempotencyResourceSchema = permissionResourceSchema;

export const idempotencyFingerprintSourceSchema = z
  .object({
    tenant_id: nonEmptyString,
    tool_id: nonEmptyString,
    tool_version: nonEmptyString,
    mode: agentModeSchema,
    requested_autonomy_level: autonomyLevelSchema,
    resource: idempotencyResourceSchema.optional(),
    arguments: z.unknown(),
    current_params_hash: hashSchema.optional(),
    human_validation_id: nonEmptyString.optional(),
  })
  .strict();

export const idempotencyClaimInputSchema = z
  .object({
    tenant_id: z.string().uuid(),
    idempotency_key: z.string(),
    correlation_id: nonEmptyString,
    tool_id: nonEmptyString,
    tool_version: nonEmptyString,
    mode: agentModeSchema,
    resource: idempotencyResourceSchema.optional(),
    request_fingerprint: hashSchema,
    now: nonEmptyString,
    ttl_seconds: z
      .number()
      .int()
      .finite()
      .min(IDEMPOTENCY_MIN_TTL_SECONDS)
      .max(IDEMPOTENCY_MAX_TTL_SECONDS),
  })
  .strict();

export const idempotencyCompleteInputSchema = z
  .object({
    record_id: z.string().uuid(),
    owner_token: nonEmptyString,
    terminal_result: idempotencyTerminalResultSchema,
    now: nonEmptyString,
  })
  .strict();

export const idempotencyFailInputSchema = z
  .object({
    record_id: z.string().uuid(),
    owner_token: nonEmptyString,
    failure_code: nonEmptyString.max(128),
    terminal_result: idempotencyTerminalResultSchema.optional(),
    now: nonEmptyString,
  })
  .strict();

/** Réponse JSON attendue de `claim_idempotency_key`. */
export const idempotencySqlClaimResponseSchema = z
  .object({
    decision: z.enum([
      "acquired",
      "replay_succeeded",
      "replay_failed",
      "conflict",
      "in_progress",
      "expired_reacquired",
    ]),
    record_id: z.string().uuid().optional().nullable(),
    expires_at: z.union([z.string(), z.number()]).optional().nullable(),
    terminal_result: z.unknown().optional().nullable(),
    terminal_result_hash: z.string().optional().nullable(),
    failure_code: z.string().optional().nullable(),
    status: z.string().optional().nullable(),
  })
  .passthrough();

/** Réponse JSON attendue de complete / fail. */
export const idempotencySqlMutationResponseSchema = z
  .object({
    ok: z.boolean(),
    error_code: z.string().optional().nullable(),
    record_id: z.string().uuid().optional().nullable(),
    status: z.string().optional().nullable(),
  })
  .passthrough();

export type ParsedIdempotencyClaimInput = z.infer<
  typeof idempotencyClaimInputSchema
>;
export type ParsedIdempotencyCompleteInput = z.infer<
  typeof idempotencyCompleteInputSchema
>;
export type ParsedIdempotencyFailInput = z.infer<
  typeof idempotencyFailInputSchema
>;
export type ParsedIdempotencyFingerprintSource = z.infer<
  typeof idempotencyFingerprintSourceSchema
>;
export type ParsedIdempotencyTerminalResult = z.infer<
  typeof idempotencyTerminalResultSchema
>;
export type ParsedIdempotencySqlClaimResponse = z.infer<
  typeof idempotencySqlClaimResponseSchema
>;
export type ParsedIdempotencySqlMutationResponse = z.infer<
  typeof idempotencySqlMutationResponseSchema
>;
