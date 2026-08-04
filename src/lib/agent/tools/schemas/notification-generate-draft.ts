import { z } from "zod";

/**
 * Contrat applicatif — 06 §11.2 « générer un brouillon » (notification).
 * Refuse les champs comptables complets (EVAL-TOOL-023).
 */
const forbiddenAccountingKeys = [
  "ledger_entries",
  "full_accounting",
  "chart_of_accounts",
  "bank_transactions",
  "tax_breakdown_full",
] as const;

export const notificationGenerateDraftInputSchema = z
  .object({
    invoice_id: z.string().min(1),
    template_id: z.string().min(1),
    locale: z.string().min(2).max(10).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const key of forbiddenAccountingKeys) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        ctx.addIssue({
          code: "custom",
          message: `champ comptable interdit: ${key}`,
          path: [key],
        });
      }
    }
  });

/** Variante de test : objet brut avant strict, pour détecter payload excessif. */
export function assertNotificationDraftPayloadMinimal(
  raw: Record<string, unknown>,
): void {
  for (const key of forbiddenAccountingKeys) {
    if (key in raw) {
      throw new Error(key);
    }
  }
}

export const notificationGenerateDraftOutputSchema = z
  .object({
    template_id: z.string().min(1),
    body_preview: z.string().min(1),
  })
  .strict();

export const NOTIFICATION_GENERATE_DRAFT_INPUT_SCHEMA_ID =
  "notification.generate_draft.input.v1";
export const NOTIFICATION_GENERATE_DRAFT_OUTPUT_SCHEMA_ID =
  "notification.generate_draft.output.v1";
