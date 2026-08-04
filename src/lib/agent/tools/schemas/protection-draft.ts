import { z } from "zod";

const attachmentMetaSchema = z
  .object({
    filename: z.string().min(1).max(255),
    content_type: z.string().min(1).max(128),
    size_bytes: z.number().int().nonnegative().max(50_000_000),
    attachment_id: z.string().min(1).max(128),
  })
  .strict();

const draftFieldNameSchema = z.enum([
  "client_name",
  "client_email",
  "expected_amount_minor",
  "currency",
  "due_date",
  "libelle",
  "reference_externe",
]);

/**
 * protection.draft.advance — message / correction / answer / acknowledge_recap.
 * Refuse tenant_id / actor_id dans les arguments (TrustedExecutionContext only).
 */
export const protectionDraftAdvanceInputSchema = z
  .object({
    draft_id: z.string().uuid().optional(),
    conversation_id: z.string().uuid().optional(),
    intent: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("message"),
          text: z.string().min(1).max(8_000),
          attachments: z.array(attachmentMetaSchema).max(10).optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("correction"),
          field: draftFieldNameSchema,
          value: z.union([z.string().min(1).max(500), z.number()]),
        })
        .strict(),
      z
        .object({
          kind: z.literal("answer"),
          text: z.string().min(1).max(2_000),
        })
        .strict(),
      z
        .object({
          kind: z.literal("acknowledge_recap"),
        })
        .strict(),
    ]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const forbidden = ["tenant_id", "actor_id", "prestataire_id", "user_id"];
    for (const key of forbidden) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        ctx.addIssue({
          code: "custom",
          message: `champ identité interdit: ${key}`,
          path: [key],
        });
      }
    }
  });

export const protectionDraftAdvanceOutputSchema = z
  .object({
    draft_id: z.string().uuid(),
    state: z.string().min(1),
    missing_fields: z.array(z.string()),
    pending_question: z.string().nullable(),
    open_ambiguities: z.array(
      z
        .object({
          kind: z.string(),
          message: z.string(),
          candidates: z.array(z.string()).optional(),
        })
        .strict(),
    ),
    recap: z
      .object({
        client_name: z.string().nullable(),
        client_email: z.string().nullable(),
        expected_amount_minor: z.number().int().nullable(),
        currency: z.string().nullable(),
        due_date: z.string().nullable(),
        libelle: z.string().nullable(),
        reference_externe: z.string().nullable(),
      })
      .strict(),
    confirmation_nonce: z.string().nullable(),
    attachments_count: z.number().int().nonnegative(),
  })
  .strict();

export const PROTECTION_DRAFT_ADVANCE_INPUT_SCHEMA_ID =
  "protection.draft.advance.input.v1";
export const PROTECTION_DRAFT_ADVANCE_OUTPUT_SCHEMA_ID =
  "protection.draft.advance.output.v1";

export const protectionDraftGetInputSchema = z
  .object({
    draft_id: z.string().uuid(),
  })
  .strict();

export const protectionDraftGetOutputSchema =
  protectionDraftAdvanceOutputSchema;

export const PROTECTION_DRAFT_GET_INPUT_SCHEMA_ID =
  "protection.draft.get.input.v1";
export const PROTECTION_DRAFT_GET_OUTPUT_SCHEMA_ID =
  "protection.draft.get.output.v1";

export const protectionDraftCancelInputSchema = z
  .object({
    draft_id: z.string().uuid(),
  })
  .strict();

export const protectionDraftCancelOutputSchema = z
  .object({
    draft_id: z.string().uuid(),
    state: z.string().min(1),
  })
  .strict();

export const PROTECTION_DRAFT_CANCEL_INPUT_SCHEMA_ID =
  "protection.draft.cancel.input.v1";
export const PROTECTION_DRAFT_CANCEL_OUTPUT_SCHEMA_ID =
  "protection.draft.cancel.output.v1";

export const protectionDraftConfirmInputSchema = z
  .object({
    draft_id: z.string().uuid(),
    /** Confirmation explicite obligatoire — doit être true. */
    explicit_confirmation: z.literal(true),
    confirmation_nonce: z.string().min(8).max(128),
  })
  .strict()
  .superRefine((value, ctx) => {
    const forbidden = ["tenant_id", "actor_id", "prestataire_id", "user_id"];
    for (const key of forbidden) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        ctx.addIssue({
          code: "custom",
          message: `champ identité interdit: ${key}`,
          path: [key],
        });
      }
    }
  });

export const protectionDraftConfirmOutputSchema = z
  .object({
    outcome: z.enum(["created", "replay"]),
    draft_id: z.string().uuid(),
    state: z.literal("TERMINE"),
    client_payeur_id: z.string().uuid(),
    creance_id: z.string().uuid(),
  })
  .strict();

export const PROTECTION_DRAFT_CONFIRM_INPUT_SCHEMA_ID =
  "protection.draft.confirm.input.v1";
export const PROTECTION_DRAFT_CONFIRM_OUTPUT_SCHEMA_ID =
  "protection.draft.confirm.output.v1";

/**
 * protection.draft.converse — message naturel via runtime LLM (G1-N).
 * Refuse tenant_id / actor_id ; jamais de confirm dans ce schéma.
 */
export const protectionDraftConverseInputSchema = z
  .object({
    draft_id: z.string().uuid().optional(),
    conversation_id: z.string().uuid().optional(),
    message: z.string().min(1).max(8_000),
    idempotency_key: z.string().min(1).max(128).optional(),
    /** Instant de référence ISO pour dates relatives (tests) ; défaut = now serveur. */
    reference_now: z.string().datetime().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const forbidden = [
      "tenant_id",
      "actor_id",
      "prestataire_id",
      "user_id",
      "explicit_confirmation",
      "confirmation_nonce",
      "fields",
      "extraction",
    ];
    for (const key of forbidden) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        ctx.addIssue({
          code: "custom",
          message: `champ interdit: ${key}`,
          path: [key],
        });
      }
    }
  });

export const protectionDraftConverseOutputSchema = z
  .object({
    draft_id: z.string().uuid(),
    state: z.string().min(1),
    missing_fields: z.array(z.string()),
    pending_question: z.string().nullable(),
    open_ambiguities: z.array(
      z
        .object({
          kind: z.string(),
          message: z.string(),
          candidates: z.array(z.string()).optional(),
        })
        .strict(),
    ),
    recap: z
      .object({
        client_name: z.string().nullable(),
        client_email: z.string().nullable(),
        expected_amount_minor: z.number().int().nullable(),
        currency: z.string().nullable(),
        due_date: z.string().nullable(),
        libelle: z.string().nullable(),
        reference_externe: z.string().nullable(),
      })
      .strict(),
    confirmation_nonce: z.string().nullable(),
    summary: z.string(),
    extraction_source: z.enum(["llm", "deterministic_fallback"]),
    fallback_used: z.boolean(),
    replay: z.boolean(),
    /** Toujours null — converse ne crée jamais le métier. */
    client_payeur_id: z.null(),
    creance_id: z.null(),
  })
  .strict();

export const PROTECTION_DRAFT_CONVERSE_INPUT_SCHEMA_ID =
  "protection.draft.converse.input.v1";
export const PROTECTION_DRAFT_CONVERSE_OUTPUT_SCHEMA_ID =
  "protection.draft.converse.output.v1";
