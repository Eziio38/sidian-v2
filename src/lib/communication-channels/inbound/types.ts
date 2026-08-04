/**
 * G1-Q — types inbound indépendants du fournisseur.
 */

import type { CommunicationProviderKind } from "../types";
import type { CommunicationActionKey } from "./actions";

export const INBOUND_PROCESSING_STATUSES = [
  "received",
  "validated",
  "correlated",
  "processing",
  "processed",
  "unresolved",
  "rejected",
  "failed",
] as const;

export type InboundProcessingStatus =
  (typeof INBOUND_PROCESSING_STATUSES)[number];

export type InboundInteraction =
  | { kind: "button"; actionKey: CommunicationActionKey }
  | { kind: "text"; text: string };

/**
 * Message entrant normalisé — aucune structure Graph / Meta.
 */
export type InboundCommunicationMessage = {
  providerKind: CommunicationProviderKind;
  providerEventId: string;
  providerMessageId: string;
  /** Référence opaque expéditeur (pas E.164 métier). */
  senderReference: string;
  sentAt: Date;
  /** Context reply WhatsApp → provider_message_id outbound. */
  replyToProviderMessageId: string | null;
  interaction: InboundInteraction;
  /** Snapshot sécurisé (sans secrets) pour audit. */
  safePayloadSnapshot: Record<string, unknown>;
};

export type InboundMessageRecord = {
  id: string;
  tenantId: string | null;
  channelId: string | null;
  providerKind: CommunicationProviderKind;
  providerEventId: string;
  providerMessageId: string;
  replyToProviderMessageId: string | null;
  senderReference: string;
  interactionKind: "button" | "text";
  actionKey: CommunicationActionKey | null;
  normalizedText: string | null;
  processingStatus: InboundProcessingStatus;
  correlatedOutboundMessageId: string | null;
  businessCommandId: string | null;
  receivedAt: string;
  processedAt: string | null;
  failedAt: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  payloadSnapshot: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export const INTERACTION_SESSION_KINDS = [
  "payment_partial_amount_collection",
] as const;

export type InteractionSessionKind =
  (typeof INTERACTION_SESSION_KINDS)[number];

export const INTERACTION_SESSION_STATUSES = [
  "awaiting_input",
  "completed",
  "expired",
  "cancelled",
  "failed",
] as const;

export type InteractionSessionStatus =
  (typeof INTERACTION_SESSION_STATUSES)[number];

export type InteractionSessionRecord = {
  id: string;
  tenantId: string;
  channelId: string;
  guideId: string;
  inboundMessageId: string;
  outboundMessageId: string;
  sessionKind: InteractionSessionKind;
  status: InteractionSessionStatus;
  businessEntityType: string;
  businessEntityId: string;
  expectedInputKind: "amount_eur_cents";
  attemptCount: number;
  maxAttempts: number;
  expiresAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Référence métier immuable portée par l'outbound G1-P. */
export type OutboundBusinessReference = {
  businessEntityType: "protection";
  businessEntityId: string;
  businessEventType: "guide_payment_confirmation";
  businessOccurrenceId: string;
  correlationKey: string;
  amountDueCents: number;
  currency: "EUR";
  clientDisplayName: string;
  amountLabel: string;
};
