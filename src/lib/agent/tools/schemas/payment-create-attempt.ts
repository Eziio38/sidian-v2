import { z } from "zod";

/**
 * Contrat applicatif — 06 §12.2 `payment.create_attempt`.
 * Aucun default sensible (devise, montant).
 * human_validation_id : enveloppe commune uniquement.
 */
export const paymentCreateAttemptInputSchema = z
  .object({
    invoice_id: z.string().min(1),
    amount_cents: z.number().int().positive(),
    currency: z.literal("EUR"),
  })
  .strict();

export const paymentCreateAttemptOutputSchema = z
  .object({
    status: z.enum([
      "success",
      "failure",
      "partial",
      "pending",
      "unknown",
    ]),
    payment_attempt_id: z.string().min(1).optional(),
    provider_status: z.string().optional(),
    external_reference: z.string().optional(),
  })
  .strict();

export const PAYMENT_CREATE_ATTEMPT_INPUT_SCHEMA_ID =
  "payment.create_attempt.input.v1";
export const PAYMENT_CREATE_ATTEMPT_OUTPUT_SCHEMA_ID =
  "payment.create_attempt.output.v1";
