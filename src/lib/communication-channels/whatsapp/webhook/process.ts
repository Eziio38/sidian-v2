import type { CommunicationMessageRepository } from "../../outbound/types";
import { parseWhatsAppStatusEvents } from "./parse";

export type WebhookEventRecord = {
  dedupeKey: string;
  processingStatus: "received" | "processed" | "ignored" | "failed";
};

export type WebhookEventRepository = {
  tryInsert(params: {
    providerKind: "whatsapp_sidian";
    dedupeKey: string;
    providerEventId: string;
    payloadSnapshot: Record<string, unknown>;
  }): Promise<"inserted" | "duplicate">;
  markProcessed(
    dedupeKey: string,
    communicationMessageId: string | null,
  ): Promise<void>;
};

export function createMemoryWebhookEventRepository(): WebhookEventRepository {
  const keys = new Set<string>();
  return {
    async tryInsert(params) {
      if (keys.has(params.dedupeKey)) return "duplicate";
      keys.add(params.dedupeKey);
      return "inserted";
    },
    async markProcessed() {
      return;
    },
  };
}

export type ProcessWhatsAppWebhookResult = {
  accepted: number;
  duplicates: number;
  applied: number;
  unknown: number;
};

/**
 * Traite un payload webhook déjà authentifié.
 * Ne prend jamais tenant_id depuis le payload comme source d'autorité.
 */
export async function processWhatsAppStatusWebhook(params: {
  payload: unknown;
  messages: CommunicationMessageRepository;
  events: WebhookEventRepository;
}): Promise<ProcessWhatsAppWebhookResult> {
  const parsed = parseWhatsAppStatusEvents(params.payload);
  let duplicates = 0;
  let applied = 0;
  let unknown = 0;

  for (const event of parsed) {
    const insert = await params.events.tryInsert({
      providerKind: "whatsapp_sidian",
      dedupeKey: event.dedupeKey,
      providerEventId: event.providerEventId,
      payloadSnapshot: {
        providerMessageId: event.providerMessageId,
        status: event.status,
        timestamp: event.timestamp,
      },
    });

    if (insert === "duplicate") {
      duplicates += 1;
      continue;
    }

    const message = await params.messages.findByProviderMessageId(
      "whatsapp_sidian",
      event.providerMessageId,
    );

    if (!message) {
      unknown += 1;
      await params.events.markProcessed(event.dedupeKey, null);
      continue;
    }

    await params.messages.applyStatusFromWebhook({
      messageId: message.id,
      status: event.status,
      at: event.timestamp,
      errorCode: event.errorCode,
      errorMessage: event.errorMessage,
    });
    await params.events.markProcessed(event.dedupeKey, message.id);
    applied += 1;
  }

  return {
    accepted: parsed.length,
    duplicates,
    applied,
    unknown,
  };
}
