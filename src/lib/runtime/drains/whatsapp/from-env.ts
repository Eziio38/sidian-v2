/**
 * Factory live fail-closed pour le drain WhatsApp outbox.
 * Jamais de repository mémoire en live.
 */

import "server-only";

import { createSupabaseCommunicationMessageRepository } from "../../../communication-channels/outbound/supabase-message-repository";
import {
  loadWhatsAppEnv,
  type WhatsAppEnv,
} from "../../../communication-channels/whatsapp/env";
import { createWhatsAppTransportFromEnv } from "../../../communication-channels/whatsapp/transport";
import { createAdminClient } from "../../../supabase/admin";
import type { OutboxDrain } from "../types";
import { createWhatsAppOutboxDrain } from "./drain";

export type CreateWhatsAppOutboxDrainFromEnvInput = {
  env?: WhatsAppEnv;
  /** Override tests uniquement — interdit en live. */
  messages?: Parameters<typeof createWhatsAppOutboxDrain>[0]["messages"];
};

/**
 * Live : service_role Supabase + transport Graph.
 * Stub local : transport stub ; messages injectés ou erreur explicite.
 * Disabled : drain no-op.
 */
export async function createWhatsAppOutboxDrainFromEnv(
  input: CreateWhatsAppOutboxDrainFromEnvInput = {},
): Promise<OutboxDrain> {
  const env = input.env ?? loadWhatsAppEnv();

  if (env.mode === "disabled") {
    return createWhatsAppOutboxDrain({
      messages: {
        async insertQueued() {
          throw new Error("whatsapp_drain_disabled");
        },
        async findByIdempotencyKey() {
          return null;
        },
        async findByProviderMessageId() {
          return null;
        },
        async claimForSending() {
          return null;
        },
        async claimQueuedBatch() {
          return [];
        },
        async markAccepted() {
          throw new Error("whatsapp_drain_disabled");
        },
        async markFailed() {
          throw new Error("whatsapp_drain_disabled");
        },
        async finalizeFailed() {
          throw new Error("whatsapp_drain_disabled");
        },
        async applyStatusFromWebhook() {
          return null;
        },
        async listQueued() {
          return [];
        },
      },
      env,
    });
  }

  if (env.mode === "live") {
    if (input.messages) {
      throw new Error(
        "whatsapp_outbox_drain_live_forbids_injected_messages_repository",
      );
    }
    const client = await createAdminClient();
    return createWhatsAppOutboxDrain({
      messages: createSupabaseCommunicationMessageRepository(
        client as unknown as import("../../../communication-channels/outbound/supabase-message-repository").MessagePersistenceClient,
      ),
      env,
      transport: createWhatsAppTransportFromEnv(env),
    });
  }

  // stub — local only (loadWhatsAppEnv déjà refuse stub hors local)
  if (!input.messages) {
    throw new Error(
      "whatsapp_outbox_drain_stub_requires_injected_messages_repository",
    );
  }
  return createWhatsAppOutboxDrain({
    messages: input.messages,
    env,
    transport: createWhatsAppTransportFromEnv(env),
  });
}
