import type {
  EmailDeliveryStatus,
  EmailLocale,
  EmailOutboxRecord,
  EmailProviderKind,
  EmailRelatedEntityType,
  EmailTemplateKey,
} from "../types";

export type InsertEmailOutboxInput = {
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
  idempotencyKey: string;
  providerKind: EmailProviderKind;
  maxAttempts?: number;
};

export type EmailOutboxRepository = {
  insertQueued(input: InsertEmailOutboxInput): Promise<EmailOutboxRecord>;
  findByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<EmailOutboxRecord | null>;
  findById(id: string): Promise<EmailOutboxRecord | null>;
  findByProviderMessageId(
    providerKind: EmailProviderKind,
    providerMessageId: string,
  ): Promise<EmailOutboxRecord | null>;
  /**
   * Claim atomique queued → processing (ou failed → processing pour retry).
   */
  claimForProcessing(id: string): Promise<EmailOutboxRecord | null>;
  markSent(
    id: string,
    providerMessageId: string,
    sentAt: string,
  ): Promise<EmailOutboxRecord>;
  /**
   * Échec retryable : revient en queued.
   */
  markFailedRetryable(
    id: string,
    errorCode: string,
    errorMessage: string,
    attemptCount: number,
  ): Promise<EmailOutboxRecord>;
  /**
   * Échec non retryable (terminal soft).
   */
  markFailedTerminal(
    id: string,
    errorCode: string,
    errorMessage: string,
    attemptCount: number,
  ): Promise<EmailOutboxRecord>;
  markDeadLetter(
    id: string,
    errorCode: string,
    errorMessage: string,
    attemptCount: number,
  ): Promise<EmailOutboxRecord>;
  listClaimable(limit: number): Promise<EmailOutboxRecord[]>;
};

export type { EmailDeliveryStatus };
