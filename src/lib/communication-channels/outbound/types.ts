export const COMMUNICATION_MESSAGE_STATUSES = [
  "queued",
  "sending",
  "accepted",
  "sent",
  "delivered",
  "read",
  "failed",
  "cancelled",
] as const;

export type CommunicationMessageStatus =
  (typeof COMMUNICATION_MESSAGE_STATUSES)[number];

/** Ordre monotone — refuse les régressions (sauf failed depuis non-terminal). */
const STATUS_RANK: Record<CommunicationMessageStatus, number> = {
  queued: 0,
  sending: 1,
  accepted: 2,
  sent: 3,
  delivered: 4,
  read: 5,
  failed: 90,
  cancelled: 91,
};

export function canTransitionMessageStatus(
  from: CommunicationMessageStatus,
  to: CommunicationMessageStatus,
): boolean {
  if (from === to) return true;
  if (from === "cancelled" || from === "failed") return false;
  if (to === "failed" || to === "cancelled") return true;
  return STATUS_RANK[to] > STATUS_RANK[from];
}

export type CommunicationMessageRecord = {
  id: string;
  tenantId: string;
  channelId: string;
  providerKind: "whatsapp_sidian" | "whatsapp_business_personal";
  direction: "outbound" | "inbound";
  recipientReference: string;
  messageKind: string;
  templateKey: string | null;
  templateLocale: string | null;
  payloadSnapshot: Record<string, unknown>;
  status: CommunicationMessageStatus;
  idempotencyKey: string;
  providerMessageId: string | null;
  attemptCount: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  queuedAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
  /** Lease fencing (P0 runtime drains). */
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  /** Backoff : ne pas reclamer avant. */
  nextAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ClaimOutboundBatchParams = {
  limit: number;
  leaseSeconds?: number;
  maxAttempts?: number;
};

export type QueueOutboundMessageInput = {
  tenantId: string;
  channelId: string;
  providerKind: "whatsapp_sidian";
  recipientReference: string;
  messageKind: string;
  templateKey: string;
  templateLocale: string;
  payloadSnapshot: Record<string, unknown>;
  idempotencyKey: string;
};

export type CommunicationMessageRepository = {
  insertQueued(
    input: QueueOutboundMessageInput,
  ): Promise<CommunicationMessageRecord>;
  findByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<CommunicationMessageRecord | null>;
  findByProviderMessageId(
    providerKind: string,
    providerMessageId: string,
  ): Promise<CommunicationMessageRecord | null>;
  findById?(id: string): Promise<CommunicationMessageRecord | null>;
  claimForSending(
    messageId: string,
  ): Promise<CommunicationMessageRecord | null>;
  /**
   * Claim atomique multi-worker (SQL SKIP LOCKED + lease en live).
   * Requis pour les drains production.
   */
  claimQueuedBatch(
    params: ClaimOutboundBatchParams,
  ): Promise<CommunicationMessageRecord[]>;
  markAccepted(
    messageId: string,
    providerMessageId: string,
    acceptedAt: string,
    leaseToken?: string | null,
  ): Promise<CommunicationMessageRecord>;
  markFailed(
    messageId: string,
    errorCode: string,
    errorMessage: string,
    attemptCount: number,
    options?: {
      leaseToken?: string | null;
      retryDelaySeconds?: number;
    },
  ): Promise<CommunicationMessageRecord>;
  /** Échec terminal (plus de retry) — dead-letter. */
  finalizeFailed(
    messageId: string,
    errorCode: string,
    errorMessage: string,
    attemptCount: number,
    leaseToken?: string | null,
  ): Promise<CommunicationMessageRecord>;
  applyStatusFromWebhook(params: {
    messageId: string;
    status: Extract<
      CommunicationMessageStatus,
      "sent" | "delivered" | "read" | "failed"
    >;
    at: string;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<CommunicationMessageRecord | null>;
  listQueued(limit: number): Promise<CommunicationMessageRecord[]>;
};

export const MAX_SEND_ATTEMPTS = 4; // initial + 3 retries
