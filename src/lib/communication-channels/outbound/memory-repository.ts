import { canTransitionMessageStatus } from "./types";
import type {
  ClaimOutboundBatchParams,
  CommunicationMessageRecord,
  CommunicationMessageRepository,
  QueueOutboundMessageInput,
} from "./types";
import { MAX_SEND_ATTEMPTS } from "./types";

function clone(row: CommunicationMessageRecord): CommunicationMessageRecord {
  return {
    ...row,
    payloadSnapshot: { ...row.payloadSnapshot },
  };
}

function newLeaseToken(): string {
  return `lease_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

export function createMemoryCommunicationMessageRepository(
  seed: CommunicationMessageRecord[] = [],
): CommunicationMessageRepository {
  const rows = new Map(seed.map((row) => [row.id, clone(row)]));
  let seq = seed.length;

  function ensureLeaseFields(row: CommunicationMessageRecord): void {
    if (row.leaseToken === undefined) row.leaseToken = null;
    if (row.leaseExpiresAt === undefined) row.leaseExpiresAt = null;
    if (row.nextAttemptAt === undefined) row.nextAttemptAt = null;
  }

  return {
    async insertQueued(input) {
      const existing = [...rows.values()].find(
        (row) =>
          row.tenantId === input.tenantId &&
          row.idempotencyKey === input.idempotencyKey,
      );
      if (existing) return clone(existing);

      const now = new Date().toISOString();
      seq += 1;
      const row: CommunicationMessageRecord = {
        id: `cmsg_${seq}`,
        tenantId: input.tenantId,
        channelId: input.channelId,
        providerKind: input.providerKind,
        direction: "outbound",
        recipientReference: input.recipientReference,
        messageKind: input.messageKind,
        templateKey: input.templateKey,
        templateLocale: input.templateLocale,
        payloadSnapshot: { ...input.payloadSnapshot },
        status: "queued",
        idempotencyKey: input.idempotencyKey,
        providerMessageId: null,
        attemptCount: 0,
        lastErrorCode: null,
        lastErrorMessage: null,
        queuedAt: now,
        sentAt: null,
        deliveredAt: null,
        readAt: null,
        failedAt: null,
        leaseToken: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(row.id, row);
      return clone(row);
    },

    async findByIdempotencyKey(tenantId, idempotencyKey) {
      const row = [...rows.values()].find(
        (item) =>
          item.tenantId === tenantId && item.idempotencyKey === idempotencyKey,
      );
      return row ? clone(row) : null;
    },

    async findByProviderMessageId(providerKind, providerMessageId) {
      const row = [...rows.values()].find(
        (item) =>
          item.providerKind === providerKind &&
          item.providerMessageId === providerMessageId,
      );
      return row ? clone(row) : null;
    },

    async findById(id) {
      const row = rows.get(id);
      return row ? clone(row) : null;
    },

    async claimForSending(messageId) {
      const row = rows.get(messageId);
      if (!row) return null;
      ensureLeaseFields(row);
      // Claim atomique : uniquement depuis queued (évite double envoi concurrent).
      if (row.status !== "queued") return null;
      if (row.nextAttemptAt && row.nextAttemptAt > new Date().toISOString()) {
        return null;
      }
      row.status = "sending";
      row.attemptCount += 1;
      row.leaseToken = newLeaseToken();
      row.leaseExpiresAt = new Date(Date.now() + 60_000).toISOString();
      row.nextAttemptAt = null;
      row.updatedAt = new Date().toISOString();
      return clone(row);
    },

    async claimQueuedBatch(params: ClaimOutboundBatchParams) {
      const now = new Date();
      const nowIso = now.toISOString();
      const leaseSeconds = params.leaseSeconds ?? 60;
      const maxAttempts = params.maxAttempts ?? MAX_SEND_ATTEMPTS;
      const claimable = [...rows.values()]
        .filter((row) => {
          ensureLeaseFields(row);
          if (row.direction !== "outbound") return false;
          if (
            row.status === "queued" &&
            row.attemptCount < maxAttempts &&
            (!row.nextAttemptAt || row.nextAttemptAt <= nowIso)
          ) {
            return true;
          }
          if (
            row.status === "sending" &&
            row.leaseExpiresAt &&
            row.leaseExpiresAt <= nowIso &&
            row.attemptCount < maxAttempts
          ) {
            return true;
          }
          return false;
        })
        .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
        .slice(0, params.limit);

      const claimed: CommunicationMessageRecord[] = [];
      for (const row of claimable) {
        row.status = "sending";
        row.attemptCount += 1;
        row.leaseToken = newLeaseToken();
        row.leaseExpiresAt = new Date(
          now.getTime() + leaseSeconds * 1000,
        ).toISOString();
        row.nextAttemptAt = null;
        row.lastErrorCode = null;
        row.lastErrorMessage = null;
        row.updatedAt = nowIso;
        claimed.push(clone(row));
      }
      return claimed;
    },

    async markAccepted(messageId, providerMessageId, acceptedAt, leaseToken) {
      const row = rows.get(messageId);
      if (!row) throw new Error("message_not_found");
      ensureLeaseFields(row);
      if (leaseToken != null && row.leaseToken !== leaseToken) {
        throw new Error("communication_outbound_lease_lost");
      }
      row.status = "accepted";
      row.providerMessageId = providerMessageId;
      row.sentAt = acceptedAt;
      row.lastErrorCode = null;
      row.lastErrorMessage = null;
      row.leaseToken = null;
      row.leaseExpiresAt = null;
      row.nextAttemptAt = null;
      row.updatedAt = acceptedAt;
      return clone(row);
    },

    async markFailed(
      messageId,
      errorCode,
      errorMessage,
      attemptCount,
      options,
    ) {
      const row = rows.get(messageId);
      if (!row) throw new Error("message_not_found");
      ensureLeaseFields(row);
      if (
        options?.leaseToken != null &&
        row.leaseToken !== options.leaseToken
      ) {
        throw new Error("communication_outbound_lease_lost");
      }
      row.attemptCount = attemptCount;
      row.lastErrorCode = errorCode;
      row.lastErrorMessage = errorMessage;
      row.updatedAt = new Date().toISOString();
      row.leaseToken = null;
      row.leaseExpiresAt = null;
      if (attemptCount >= MAX_SEND_ATTEMPTS) {
        row.status = "failed";
        row.failedAt = row.updatedAt;
        row.nextAttemptAt = null;
      } else {
        row.status = "queued";
        const delay = options?.retryDelaySeconds ?? 30;
        row.nextAttemptAt = new Date(Date.now() + delay * 1000).toISOString();
      }
      return clone(row);
    },

    async finalizeFailed(
      messageId,
      errorCode,
      errorMessage,
      attemptCount,
      leaseToken,
    ) {
      const row = rows.get(messageId);
      if (!row) throw new Error("message_not_found");
      ensureLeaseFields(row);
      if (leaseToken != null && row.leaseToken !== leaseToken) {
        throw new Error("communication_outbound_lease_lost");
      }
      row.status = "failed";
      row.attemptCount = attemptCount;
      row.lastErrorCode = errorCode;
      row.lastErrorMessage = errorMessage;
      row.failedAt = new Date().toISOString();
      row.updatedAt = row.failedAt;
      row.leaseToken = null;
      row.leaseExpiresAt = null;
      row.nextAttemptAt = null;
      return clone(row);
    },

    async applyStatusFromWebhook(params) {
      const row = rows.get(params.messageId);
      if (!row) return null;
      if (!canTransitionMessageStatus(row.status, params.status)) {
        return clone(row);
      }
      row.status = params.status;
      row.updatedAt = params.at;
      if (params.status === "sent" && !row.sentAt) row.sentAt = params.at;
      if (params.status === "delivered") row.deliveredAt = params.at;
      if (params.status === "read") row.readAt = params.at;
      if (params.status === "failed") {
        row.failedAt = params.at;
        row.lastErrorCode = params.errorCode ?? row.lastErrorCode;
        row.lastErrorMessage = params.errorMessage ?? row.lastErrorMessage;
      }
      return clone(row);
    },

    async listQueued(limit) {
      const nowIso = new Date().toISOString();
      return [...rows.values()]
        .filter(
          (row) =>
            row.status === "queued" &&
            (!row.nextAttemptAt || row.nextAttemptAt <= nowIso),
        )
        .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
        .slice(0, limit)
        .map(clone);
    },
  };
}
