/**
 * G1-Q — parse défensif des messages inbound WhatsApp (Meta webhook).
 * Ne throw jamais ; ignore les structures inconnues.
 */

import { mapProviderActionIdToKey } from "../../inbound/actions";
import type { InboundCommunicationMessage } from "../../inbound/types";
import { opaqueWhatsAppSenderReference } from "./sender-reference";

const PROVIDER_KIND = "whatsapp_sidian" as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseSentAt(timestamp: unknown): Date {
  if (typeof timestamp === "string" || typeof timestamp === "number") {
    const seconds = Number(timestamp);
    if (Number.isFinite(seconds) && seconds > 0) {
      return new Date(seconds * 1000);
    }
  }
  return new Date();
}

function readReplyToProviderMessageId(
  message: Record<string, unknown>,
): string | null {
  const context = asRecord(message.context);
  if (!context) return null;
  return readNonEmptyString(context.id);
}

/**
 * Snapshot audit — ids, types, timestamps, action ids uniquement.
 * Pas de tokens, pas de numéros E.164, pas de corps de texte.
 */
function buildSafeSnapshot(fields: {
  messageType: string;
  providerMessageId: string;
  timestamp: unknown;
  replyToProviderMessageId: string | null;
  interactiveType?: string;
  providerActionId?: string;
}): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {
    messageType: fields.messageType,
    providerMessageId: fields.providerMessageId,
  };

  if (
    typeof fields.timestamp === "string" ||
    typeof fields.timestamp === "number"
  ) {
    snapshot.timestamp = fields.timestamp;
  }

  if (fields.replyToProviderMessageId) {
    snapshot.replyToProviderMessageId = fields.replyToProviderMessageId;
  }

  if (fields.interactiveType) {
    snapshot.interactiveType = fields.interactiveType;
  }

  if (fields.providerActionId) {
    snapshot.providerActionId = fields.providerActionId;
  }

  return snapshot;
}

function parseInteractiveMessage(params: {
  message: Record<string, unknown>;
  providerMessageId: string;
  senderReference: string;
  sentAt: Date;
  replyToProviderMessageId: string | null;
  timestamp: unknown;
}): InboundCommunicationMessage | null {
  const interactive = asRecord(params.message.interactive);
  if (!interactive) return null;

  const interactiveType = readNonEmptyString(interactive.type);
  if (
    interactiveType !== "list_reply" &&
    interactiveType !== "button_reply"
  ) {
    return null;
  }

  const reply =
    interactiveType === "list_reply"
      ? asRecord(interactive.list_reply)
      : asRecord(interactive.button_reply);
  if (!reply) return null;

  const providerActionId = readNonEmptyString(reply.id);
  if (!providerActionId) return null;

  const title = typeof reply.title === "string" ? reply.title : "";
  const actionKey = mapProviderActionIdToKey(providerActionId);

  const safePayloadSnapshot = buildSafeSnapshot({
    messageType: "interactive",
    providerMessageId: params.providerMessageId,
    timestamp: params.timestamp,
    replyToProviderMessageId: params.replyToProviderMessageId,
    interactiveType,
    providerActionId,
  });

  return {
    providerKind: PROVIDER_KIND,
    providerEventId: `wamid:${params.providerMessageId}`,
    providerMessageId: params.providerMessageId,
    senderReference: params.senderReference,
    sentAt: params.sentAt,
    replyToProviderMessageId: params.replyToProviderMessageId,
    interaction: actionKey
      ? { kind: "button", actionKey }
      : { kind: "text", text: title },
    safePayloadSnapshot,
  };
}

function parseTextMessage(params: {
  message: Record<string, unknown>;
  providerMessageId: string;
  senderReference: string;
  sentAt: Date;
  replyToProviderMessageId: string | null;
  timestamp: unknown;
}): InboundCommunicationMessage | null {
  const textObj = asRecord(params.message.text);
  if (!textObj) return null;

  const text = typeof textObj.body === "string" ? textObj.body : "";

  return {
    providerKind: PROVIDER_KIND,
    providerEventId: `wamid:${params.providerMessageId}`,
    providerMessageId: params.providerMessageId,
    senderReference: params.senderReference,
    sentAt: params.sentAt,
    replyToProviderMessageId: params.replyToProviderMessageId,
    interaction: { kind: "text", text },
    safePayloadSnapshot: buildSafeSnapshot({
      messageType: "text",
      providerMessageId: params.providerMessageId,
      timestamp: params.timestamp,
      replyToProviderMessageId: params.replyToProviderMessageId,
    }),
  };
}

function parseSingleMessage(
  message: unknown,
): InboundCommunicationMessage | null {
  const record = asRecord(message);
  if (!record) return null;

  const providerMessageId = readNonEmptyString(record.id);
  const from = readNonEmptyString(record.from);
  if (!providerMessageId || !from) return null;

  const messageType = readNonEmptyString(record.type);
  if (!messageType) return null;

  const senderReference = opaqueWhatsAppSenderReference(from);
  const sentAt = parseSentAt(record.timestamp);
  const replyToProviderMessageId = readReplyToProviderMessageId(record);

  if (messageType === "interactive") {
    return parseInteractiveMessage({
      message: record,
      providerMessageId,
      senderReference,
      sentAt,
      replyToProviderMessageId,
      timestamp: record.timestamp,
    });
  }

  if (messageType === "text") {
    return parseTextMessage({
      message: record,
      providerMessageId,
      senderReference,
      sentAt,
      replyToProviderMessageId,
      timestamp: record.timestamp,
    });
  }

  return null;
}

function walkMessageArrays(
  payload: unknown,
  onMessages: (messages: unknown[]) => void,
): void {
  if (!payload || typeof payload !== "object") return;
  const entries = (payload as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return;

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const changes = (entry as { changes?: unknown }).changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      if (!change || typeof change !== "object") continue;
      const value = (change as { value?: unknown }).value;
      if (!value || typeof value !== "object") continue;
      const messages = (value as { messages?: unknown }).messages;
      if (!Array.isArray(messages)) continue;
      onMessages(messages);
    }
  }
}

/**
 * Parse défensif — ignore les structures inconnues sans throw.
 */
export function parseWhatsAppInboundMessages(
  payload: unknown,
): InboundCommunicationMessage[] {
  const results: InboundCommunicationMessage[] = [];

  walkMessageArrays(payload, (messages) => {
    for (const message of messages) {
      const parsed = parseSingleMessage(message);
      if (parsed) results.push(parsed);
    }
  });

  return results;
}

/**
 * Indique si le payload webhook contient au moins un élément messages[].
 * Utile pour brancher inbound vs status sans parser entièrement.
 */
export function hasInboundMessages(payload: unknown): boolean {
  let found = false;
  walkMessageArrays(payload, (messages) => {
    if (messages.length > 0) found = true;
  });
  return found;
}
