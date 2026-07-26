/**
 * G1-Q — interfaces de persistance inbound.
 *
 * - InboundMessageRepository.update → mark* (validated / correlated / processed / …)
 * - InteractionSessionRepository.setStatus → complete / expire / cancel / fail
 */

import type { CommunicationMessageRecord } from "../outbound/types";
import type {
  GuidePaymentConfirmationRecord,
} from "./domain/types";
import type {
  InboundMessageRecord,
  InboundProcessingStatus,
  InteractionSessionRecord,
  InteractionSessionStatus,
} from "./types";
import type { CommunicationActionKey } from "./actions";

export type InboundMessageRepository = {
  tryInsert(input: {
    providerKind: InboundMessageRecord["providerKind"];
    providerEventId: string;
    providerMessageId: string;
    replyToProviderMessageId: string | null;
    senderReference: string;
    interactionKind: "button" | "text";
    actionKey: CommunicationActionKey | null;
    normalizedText: string | null;
    payloadSnapshot: Record<string, unknown>;
    receivedAt: string;
  }): Promise<{ outcome: "inserted" | "duplicate"; record: InboundMessageRecord }>;
  claimForProcessing(
    id: string,
  ): Promise<InboundMessageRecord | null>;
  update(params: {
    id: string;
    tenantId?: string | null;
    channelId?: string | null;
    processingStatus: InboundProcessingStatus;
    correlatedOutboundMessageId?: string | null;
    businessCommandId?: string | null;
    actionKey?: CommunicationActionKey | null;
    processedAt?: string | null;
    failedAt?: string | null;
    failureCode?: string | null;
    failureMessage?: string | null;
  }): Promise<InboundMessageRecord>;
  findById(id: string): Promise<InboundMessageRecord | null>;
};

export type InteractionSessionRepository = {
  create(
    input: Omit<
      InteractionSessionRecord,
      "id" | "createdAt" | "updatedAt" | "completedAt" | "cancelledAt"
    > & { id?: string },
  ): Promise<InteractionSessionRecord>;
  findActive(params: {
    tenantId: string;
    channelId: string;
    guideId: string;
    now: string;
  }): Promise<InteractionSessionRecord | null>;
  incrementAttempts(id: string): Promise<InteractionSessionRecord>;
  setStatus(params: {
    id: string;
    status: InteractionSessionStatus;
    at: string;
  }): Promise<InteractionSessionRecord>;
};

export type GuidePaymentConfirmationRepository = {
  getOrCreate(params: {
    tenantId: string;
    protectionId: string;
    occurrenceId: string;
    amountDueCents: number;
    sourceOutboundMessageId: string;
    now: string;
  }): Promise<GuidePaymentConfirmationRecord>;
  save(
    record: GuidePaymentConfirmationRecord,
  ): Promise<GuidePaymentConfirmationRecord>;
  findByBusinessKey(params: {
    tenantId: string;
    protectionId: string;
    occurrenceId: string;
  }): Promise<GuidePaymentConfirmationRecord | null>;
};

/** Corrélation outbound — lecture seule. */
export type OutboundMessageLookup = {
  findByProviderMessageId(
    providerKind: string,
    providerMessageId: string,
  ): Promise<CommunicationMessageRecord | null>;
  findById(id: string): Promise<CommunicationMessageRecord | null>;
};
