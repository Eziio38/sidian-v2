import {
  createInitialGuidePaymentConfirmation,
} from "./domain/apply";
import type { GuidePaymentConfirmationRecord } from "./domain/types";
import type {
  GuidePaymentConfirmationRepository,
  InboundMessageRepository,
  InteractionSessionRepository,
} from "./repositories";
import type {
  InboundMessageRecord,
  InteractionSessionRecord,
} from "./types";

function nowIso() {
  return new Date().toISOString();
}

/**
 * Claim concurrent-safe : une seule transition vers `processing`
 * depuis received|validated|correlated (file sérialisée).
 */
export function createMemoryInboundMessageRepository(): InboundMessageRepository {
  const rows = new Map<string, InboundMessageRecord>();
  const byEvent = new Map<string, string>();
  let seq = 0;
  let claimChain: Promise<void> = Promise.resolve();

  function withClaimLock<T>(fn: () => T): Promise<T> {
    const run = claimChain.then(() => fn());
    claimChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  return {
    async tryInsert(input) {
      const dedupe = `${input.providerKind}:${input.providerEventId}`;
      const existingId = byEvent.get(dedupe);
      if (existingId) {
        return { outcome: "duplicate", record: { ...rows.get(existingId)! } };
      }
      seq += 1;
      const id = `inb_${seq}`;
      const at = input.receivedAt;
      const record: InboundMessageRecord = {
        id,
        tenantId: null,
        channelId: null,
        providerKind: input.providerKind,
        providerEventId: input.providerEventId,
        providerMessageId: input.providerMessageId,
        replyToProviderMessageId: input.replyToProviderMessageId,
        senderReference: input.senderReference,
        interactionKind: input.interactionKind,
        actionKey: input.actionKey,
        normalizedText: input.normalizedText,
        processingStatus: "received",
        correlatedOutboundMessageId: null,
        businessCommandId: null,
        receivedAt: at,
        processedAt: null,
        failedAt: null,
        failureCode: null,
        failureMessage: null,
        payloadSnapshot: { ...input.payloadSnapshot },
        createdAt: at,
        updatedAt: at,
      };
      rows.set(id, record);
      byEvent.set(dedupe, id);
      return { outcome: "inserted", record: { ...record } };
    },

    async claimForProcessing(id) {
      return withClaimLock(() => {
        const row = rows.get(id);
        if (!row) return null;
        if (
          row.processingStatus !== "received" &&
          row.processingStatus !== "validated" &&
          row.processingStatus !== "correlated"
        ) {
          return null;
        }
        row.processingStatus = "processing";
        row.updatedAt = nowIso();
        return { ...row };
      });
    },

    async update(params) {
      const row = rows.get(params.id);
      if (!row) throw new Error("inbound_not_found");
      if (params.tenantId !== undefined) row.tenantId = params.tenantId;
      if (params.channelId !== undefined) row.channelId = params.channelId;
      row.processingStatus = params.processingStatus;
      if (params.correlatedOutboundMessageId !== undefined) {
        row.correlatedOutboundMessageId = params.correlatedOutboundMessageId;
      }
      if (params.businessCommandId !== undefined) {
        row.businessCommandId = params.businessCommandId;
      }
      if (params.actionKey !== undefined) row.actionKey = params.actionKey;
      if (params.processedAt !== undefined) row.processedAt = params.processedAt;
      if (params.failedAt !== undefined) row.failedAt = params.failedAt;
      if (params.failureCode !== undefined) {
        row.failureCode = params.failureCode;
      }
      if (params.failureMessage !== undefined) {
        row.failureMessage = params.failureMessage;
      }
      row.updatedAt = nowIso();
      return { ...row };
    },

    async findById(id) {
      const row = rows.get(id);
      return row ? { ...row } : null;
    },
  };
}

export function createMemoryInteractionSessionRepository(): InteractionSessionRepository {
  const rows = new Map<string, InteractionSessionRecord>();
  let seq = 0;

  return {
    async create(input) {
      seq += 1;
      const id = input.id ?? `sess_${seq}`;
      const at = nowIso();
      const record: InteractionSessionRecord = {
        id,
        tenantId: input.tenantId,
        channelId: input.channelId,
        guideId: input.guideId,
        inboundMessageId: input.inboundMessageId,
        outboundMessageId: input.outboundMessageId,
        sessionKind: input.sessionKind,
        status: input.status,
        businessEntityType: input.businessEntityType,
        businessEntityId: input.businessEntityId,
        expectedInputKind: input.expectedInputKind,
        attemptCount: input.attemptCount,
        maxAttempts: input.maxAttempts,
        expiresAt: input.expiresAt,
        completedAt: null,
        cancelledAt: null,
        createdAt: at,
        updatedAt: at,
      };
      rows.set(id, record);
      return { ...record };
    },

    async findActive({ tenantId, channelId, guideId, now }) {
      const active = [...rows.values()].find(
        (row) =>
          row.tenantId === tenantId &&
          row.channelId === channelId &&
          row.guideId === guideId &&
          row.status === "awaiting_input" &&
          row.expiresAt > now,
      );
      return active ? { ...active } : null;
    },

    async incrementAttempts(id) {
      const row = rows.get(id);
      if (!row) throw new Error("session_not_found");
      row.attemptCount += 1;
      row.updatedAt = nowIso();
      return { ...row };
    },

    async setStatus({ id, status, at }) {
      const row = rows.get(id);
      if (!row) throw new Error("session_not_found");
      row.status = status;
      row.updatedAt = at;
      if (status === "completed") row.completedAt = at;
      if (status === "cancelled" || status === "failed" || status === "expired") {
        row.cancelledAt = at;
      }
      return { ...row };
    },
  };
}

export function createMemoryGuidePaymentConfirmationRepository(): GuidePaymentConfirmationRepository {
  const rows = new Map<string, GuidePaymentConfirmationRecord>();
  let seq = 0;

  function key(tenantId: string, protectionId: string, occurrenceId: string) {
    return `${tenantId}:${protectionId}:${occurrenceId}`;
  }

  return {
    async getOrCreate(params) {
      const k = key(params.tenantId, params.protectionId, params.occurrenceId);
      const existing = rows.get(k);
      if (existing) return { ...existing };
      seq += 1;
      const record = createInitialGuidePaymentConfirmation({
        id: `gpc_${seq}`,
        tenantId: params.tenantId,
        protectionId: params.protectionId,
        occurrenceId: params.occurrenceId,
        amountDueCents: params.amountDueCents,
        now: params.now,
        sourceOutboundMessageId: params.sourceOutboundMessageId,
      });
      rows.set(k, record);
      return { ...record };
    },

    async save(record) {
      const k = key(record.tenantId, record.protectionId, record.occurrenceId);
      rows.set(k, { ...record });
      return { ...record };
    },

    async findByBusinessKey(params) {
      const row = rows.get(
        key(params.tenantId, params.protectionId, params.occurrenceId),
      );
      return row ? { ...row } : null;
    },
  };
}
