import type {
  EmailOutboxRecord,
  EmailProviderKind,
} from "../types";
import type {
  EmailOutboxRepository,
  InsertEmailOutboxInput,
} from "./repository";

function clone(row: EmailOutboxRecord): EmailOutboxRecord {
  return {
    ...row,
    variablesSnapshot: { ...row.variablesSnapshot },
  };
}

export function createMemoryEmailOutboxRepository(
  seed: EmailOutboxRecord[] = [],
): EmailOutboxRepository {
  const rows = new Map(seed.map((row) => [row.id, clone(row)]));
  let seq = seed.length;

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
      const row: EmailOutboxRecord = {
        id: `email_${seq}`,
        tenantId: input.tenantId,
        templateKey: input.templateKey,
        templateLocale: input.templateLocale,
        recipientEmail: input.recipientEmail,
        recipientName: input.recipientName,
        recipientEmailHash: input.recipientEmailHash,
        subject: input.subject,
        bodyText: input.bodyText,
        bodyHtml: input.bodyHtml,
        variablesSnapshot: { ...input.variablesSnapshot },
        relatedEntityType: input.relatedEntityType,
        relatedEntityId: input.relatedEntityId,
        status: "queued",
        idempotencyKey: input.idempotencyKey,
        providerKind: input.providerKind,
        providerMessageId: null,
        attemptCount: 0,
        maxAttempts: input.maxAttempts ?? 4,
        lastErrorCode: null,
        lastErrorMessage: null,
        queuedAt: now,
        processedAt: null,
        sentAt: null,
        failedAt: null,
        deadLetteredAt: null,
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

    async findById(id) {
      const row = rows.get(id);
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

    async claimForProcessing(id) {
      const row = rows.get(id);
      if (!row) return null;
      // Claim atomique : uniquement depuis queued (failed terminal non rejouable).
      if (row.status !== "queued") return null;
      row.status = "processing";
      row.attemptCount += 1;
      row.processedAt = new Date().toISOString();
      row.updatedAt = row.processedAt;
      return clone(row);
    },

    async markSent(id, providerMessageId, sentAt) {
      const row = rows.get(id);
      if (!row) throw new Error("email_outbox_not_found");
      row.status = "sent";
      row.providerMessageId = providerMessageId;
      row.sentAt = sentAt;
      row.lastErrorCode = null;
      row.lastErrorMessage = null;
      row.updatedAt = sentAt;
      return clone(row);
    },

    async markFailedRetryable(id, errorCode, errorMessage, attemptCount) {
      const row = rows.get(id);
      if (!row) throw new Error("email_outbox_not_found");
      row.status = "queued";
      row.attemptCount = attemptCount;
      row.lastErrorCode = errorCode;
      row.lastErrorMessage = errorMessage;
      row.updatedAt = new Date().toISOString();
      return clone(row);
    },

    async markFailedTerminal(id, errorCode, errorMessage, attemptCount) {
      const row = rows.get(id);
      if (!row) throw new Error("email_outbox_not_found");
      row.status = "failed";
      row.attemptCount = attemptCount;
      row.lastErrorCode = errorCode;
      row.lastErrorMessage = errorMessage;
      row.failedAt = new Date().toISOString();
      row.updatedAt = row.failedAt;
      return clone(row);
    },

    async markDeadLetter(id, errorCode, errorMessage, attemptCount) {
      const row = rows.get(id);
      if (!row) throw new Error("email_outbox_not_found");
      row.status = "dead_letter";
      row.attemptCount = attemptCount;
      row.lastErrorCode = errorCode;
      row.lastErrorMessage = errorMessage;
      row.deadLetteredAt = new Date().toISOString();
      row.updatedAt = row.deadLetteredAt;
      return clone(row);
    },

    async listClaimable(limit) {
      return [...rows.values()]
        .filter((row) => row.status === "queued")
        .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
        .slice(0, limit)
        .map(clone);
    },
  };
}

/** Helper tests — expose seed provider kind. */
export type MemorySeedProviderKind = EmailProviderKind;
