/**
 * G1-P / G1-Q — factory deps live WhatsApp webhook.
 * Live = Supabase service_role obligatoire (jamais mémoire processus).
 */

import { createInboundCommunicationService } from "../../inbound/service";
import {
  createSupabaseGuidePaymentConfirmationRepository,
  createSupabaseInboundMessageRepository,
  createSupabaseInteractionSessionRepository,
  type InboundPersistenceClient,
} from "../../inbound/supabase-repositories";
import {
  createMemoryIdentityDirectory,
  type CommunicationIdentity,
  type CommunicationIdentityDirectory,
} from "../../inbound/identity";
import { createSupabaseCommunicationMessageRepository } from "../../outbound/supabase-message-repository";
import type { MessagePersistenceClient } from "../../outbound/supabase-message-repository";
import type { CommunicationMessageRepository } from "../../outbound/types";
import { createSupabaseWebhookEventRepository } from "./supabase-webhook-event-repository";
import type { WebhookEventPersistenceClient } from "./supabase-webhook-event-repository";
import type { WebhookEventRepository } from "./process";

/**
 * Client PostgREST injecté (Supabase service_role typiquement).
 * Typage large : les génériques Supabase ne sont pas structurellement
 * assignables aux builders métier sans assertion de frontière.
 */
export type WhatsAppLivePersistenceClient = {
  from(relation: string): unknown;
};

export type WhatsAppWebhookRuntimeDeps = {
  messages: CommunicationMessageRepository;
  events: WebhookEventRepository;
  /** true uniquement pour stub/test mémoire — live doit être false. */
  eventsAreMemory: boolean;
  inboundService: ReturnType<typeof createInboundCommunicationService> | null;
};

export type CreateLiveWhatsAppWebhookDepsInput = {
  client: WhatsAppLivePersistenceClient;
  guideRecipientTechnicalId: string;
  /**
   * Identités Guide préenregistrées (canal + senderReference).
   * Table dédiée hors scope G1-Q — injection applicative.
   */
  identities?: CommunicationIdentity[];
  identityDirectory?: CommunicationIdentityDirectory;
};

function asTypedPersistenceClient(client: WhatsAppLivePersistenceClient): MessagePersistenceClient &
  InboundPersistenceClient &
  WebhookEventPersistenceClient {
  return client as MessagePersistenceClient &
    InboundPersistenceClient &
    WebhookEventPersistenceClient;
}

/**
 * Construit les deps webhook live : messages + events + inbound via Supabase.
 * Aucun repository mémoire.
 */
export function createLiveWhatsAppWebhookDeps(
  input: CreateLiveWhatsAppWebhookDepsInput,
): WhatsAppWebhookRuntimeDeps {
  const client = asTypedPersistenceClient(input.client);
  const messages = createSupabaseCommunicationMessageRepository(client);
  const events = createSupabaseWebhookEventRepository(client);
  const identities =
    input.identityDirectory ??
    createMemoryIdentityDirectory(input.identities ?? []);

  const inboundService = createInboundCommunicationService({
    inbound: createSupabaseInboundMessageRepository(client),
    sessions: createSupabaseInteractionSessionRepository(client),
    confirmations: createSupabaseGuidePaymentConfirmationRepository(
      client,
    ),
    outboundMessages: messages,
    identities,
    guideRecipientTechnicalId: input.guideRecipientTechnicalId,
  });

  return {
    messages,
    events,
    eventsAreMemory: false,
    inboundService,
  };
}
