/**
 * Types domaine email — jamais de dépendance vendor.
 */

export const EMAIL_TEMPLATE_KEYS = [
  "reminder_before_due",
  "reminder_after_due",
  "payment_received",
  "payment_failed",
  "update_payment_method",
  "cancellation_notice",
  "partial_payment_notice",
  "guide_internal_notice",
] as const;

export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

export const EMAIL_DELIVERY_STATUSES = [
  "queued",
  "processing",
  "sent",
  "failed",
  "dead_letter",
] as const;

export type EmailDeliveryStatus = (typeof EMAIL_DELIVERY_STATUSES)[number];

export const EMAIL_PROVIDER_KINDS = ["resend", "stub"] as const;
export type EmailProviderKind = (typeof EMAIL_PROVIDER_KINDS)[number];

export const EMAIL_LOCALES = ["fr"] as const;
export type EmailLocale = (typeof EMAIL_LOCALES)[number];

export const EMAIL_RELATED_ENTITY_TYPES = [
  "creance",
  "paiement",
  "tentative_paiement",
  "client_payeur",
  "protection",
  "guide",
] as const;

export type EmailRelatedEntityType =
  (typeof EMAIL_RELATED_ENTITY_TYPES)[number];

/** Destinataire canonique (adresse déjà validée). */
export type EmailRecipient = {
  email: string;
  name?: string;
};

/** Message prêt pour le provider (HTML + text/plain déterministes). */
export type EmailMessage = {
  to: EmailRecipient;
  from: {
    email: string;
    name?: string;
  };
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
  /** Tags / headers non PII pour le provider. */
  tags?: Array<{ name: string; value: string }>;
  headers?: Record<string, string>;
  idempotencyKey?: string;
};

export type EmailOutboxRecord = {
  id: string;
  tenantId: string;
  templateKey: EmailTemplateKey;
  templateLocale: EmailLocale;
  recipientEmail: string;
  recipientName: string | null;
  recipientEmailHash: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  variablesSnapshot: Record<string, unknown>;
  relatedEntityType: EmailRelatedEntityType | null;
  relatedEntityId: string | null;
  status: EmailDeliveryStatus;
  idempotencyKey: string;
  providerKind: EmailProviderKind;
  providerMessageId: string | null;
  attemptCount: number;
  maxAttempts: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  queuedAt: string;
  processedAt: string | null;
  sentAt: string | null;
  failedAt: string | null;
  deadLetteredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** 1 initiale + 3 retries. */
export const EMAIL_MAX_SEND_ATTEMPTS = 4;

const STATUS_RANK: Record<EmailDeliveryStatus, number> = {
  queued: 0,
  processing: 1,
  sent: 2,
  failed: 90,
  dead_letter: 91,
};

export function canTransitionEmailStatus(
  from: EmailDeliveryStatus,
  to: EmailDeliveryStatus,
): boolean {
  if (from === to) return true;
  if (from === "sent" || from === "dead_letter") return false;
  if (to === "dead_letter") return true;
  if (to === "failed") return from === "processing" || from === "queued";
  if (from === "failed" && to === "queued") return true;
  if (from === "failed" && to === "processing") return true;
  return STATUS_RANK[to] > STATUS_RANK[from];
}

export function isEmailTemplateKey(value: string): value is EmailTemplateKey {
  return (EMAIL_TEMPLATE_KEYS as readonly string[]).includes(value);
}
