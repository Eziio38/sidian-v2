/**
 * G1-N — schéma Zod strict de sortie LLM.
 * Refuse tenant/actor/confirm/send/payment et tout champ inconnu.
 */

import { z } from "zod";

import { CONVERSATIONAL_RUNTIME_SCHEMA_VERSION } from "./types";

const confidenceSchema = z.number().min(0).max(1);

const fieldConfidenceSchema = z
  .object({
    value: z.union([z.string().min(1).max(500), z.number()]),
    confidence: confidenceSchema,
  })
  .strict();

const nullableField = fieldConfidenceSchema.nullable().optional();

const ambiguitySchema = z
  .object({
    kind: z.enum(["due_date", "currency", "amount"]),
    message: z.string().min(1).max(500),
    candidates: z.array(z.string().min(1).max(64)).max(5).optional(),
  })
  .strict();

const FORBIDDEN_TOP_LEVEL = new Set([
  "tenant_id",
  "actor_id",
  "prestataire_id",
  "user_id",
  "explicit_confirmation",
  "confirmation_nonce",
  "client_payeur_id",
  "creance_id",
  "confirm",
  "send_message",
  "whatsapp",
  "sms",
  "email_send",
  "payment",
  "prélèvement",
  "prelevement",
  "system_prompt",
  "jwt",
  "access_token",
]);

export const llmStructuredExtractionSchema = z
  .object({
    schema_version: z.literal(CONVERSATIONAL_RUNTIME_SCHEMA_VERSION),
    fields: z
      .object({
        client_name: nullableField,
        client_email: nullableField,
        expected_amount_minor: nullableField,
        currency: nullableField,
        due_date: nullableField,
        libelle: nullableField,
        reference_externe: nullableField,
      })
      .strict(),
    ambiguities: z.array(ambiguitySchema).max(10).default([]),
    model_notes: z.string().max(500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (FORBIDDEN_TOP_LEVEL.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: `champ interdit: ${key}`,
          path: [key],
        });
      }
    }
  });

export type LlmStructuredExtractionParsed = z.infer<
  typeof llmStructuredExtractionSchema
>;

/** Seuil sous lequel un champ LLM est ignoré (jamais inventé « à moitié »). */
export const MIN_FIELD_CONFIDENCE = 0.55;
