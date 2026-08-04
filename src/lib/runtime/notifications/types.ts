/**
 * Runtime notifications P0 — types domaine.
 *
 * `invoice_id` dans les contrats agent (G1-B) désigne l’identifiant de
 * **créance** (« paiement à recevoir »). Sidian n’émet pas de facture légale
 * au MVP (01 §6, 02 §1/§8).
 */

export type CreanceSnapshot = {
  id: string;
  tenantId: string;
  amountCents: number;
  currency: "EUR";
  /** `creance.etat` — exposé tel quel comme `status` de invoice.get. */
  status: string;
  dueDate: string;
  clientName: string | null;
  libelle: string | null;
};

export type CreanceLookup = {
  findById(
    tenantId: string,
    creanceId: string,
  ): Promise<CreanceSnapshot | null>;
};

export type InvoiceGetResult = {
  invoice_id: string;
  amount_cents: number;
  currency: "EUR";
  status: string;
};

export type NotificationDraftResult = {
  template_id: string;
  body_preview: string;
};

/**
 * Templates brouillon autorisés (alignés email P0 + WhatsApp Guide).
 * Aucun envoi depuis `notification.generate_draft` (side_effect create_draft_only).
 */
export const NOTIFICATION_DRAFT_TEMPLATE_IDS = [
  "reminder_before_due",
  "reminder_after_due",
  "payment_received",
  "payment_failed",
  "update_payment_method",
  "cancellation_notice",
  "partial_payment_notice",
  "guide_internal_notice",
  "guide_payment_confirmation",
] as const;

export type NotificationDraftTemplateId =
  (typeof NOTIFICATION_DRAFT_TEMPLATE_IDS)[number];

export function isNotificationDraftTemplateId(
  value: string,
): value is NotificationDraftTemplateId {
  return (NOTIFICATION_DRAFT_TEMPLATE_IDS as readonly string[]).includes(
    value,
  );
}

/** Capacités explicitement hors MVP — ne pas implémenter ici. */
export const OUT_OF_SCOPE_P0 = {
  invoice_emission: true,
  invoice_sync_pennylane: true,
  accounting_export: true,
  account_data_export: true,
} as const;
