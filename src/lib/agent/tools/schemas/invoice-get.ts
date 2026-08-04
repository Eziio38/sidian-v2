import { z } from "zod";

/**
 * Contrat applicatif de consultation — 06 §11.1 « lire une facture ».
 * Données minimales uniquement (pas d’IBAN / carte / doc comptable complet).
 */
export const invoiceGetInputSchema = z
  .object({
    invoice_id: z.string().min(1),
  })
  .strict();

export const invoiceGetOutputSchema = z
  .object({
    invoice_id: z.string().min(1),
    amount_cents: z.number().int().nonnegative(),
    currency: z.literal("EUR"),
    status: z.string().min(1),
  })
  .strict();

export const INVOICE_GET_INPUT_SCHEMA_ID = "invoice.get.input.v1";
export const INVOICE_GET_OUTPUT_SCHEMA_ID = "invoice.get.output.v1";
