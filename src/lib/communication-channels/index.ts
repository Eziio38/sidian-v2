export type {
  CommunicationChannel,
  CommunicationChannelRepository,
  CommunicationChannelStatus,
  CommunicationProvider,
  CommunicationProviderKind,
  ImplementedCommunicationProvider,
  OutboundClientMessageInput,
  OutboundClientMessageResult,
  ProviderSendInput,
  ProviderSendResult,
  ResolveChannelInput,
} from "./types";
export {
  COMMUNICATION_CHANNEL_STATUSES,
  COMMUNICATION_PROVIDER_KINDS,
  IMPLEMENTED_COMMUNICATION_PROVIDERS,
} from "./types";

export {
  COMMUNICATION_CHANNEL_ERROR_CODES,
  CommunicationChannelError,
  isCommunicationChannelError,
} from "./errors";
export type { CommunicationChannelErrorCode } from "./errors";

export { resolveCommunicationChannel } from "./resolve";

export {
  assertNoPhoneInBusinessInput,
  createCommunicationOutboundService,
} from "./service";
export type { CommunicationOutboundService } from "./service";

export {
  createWhatsAppSidianProvider,
  getProviderOrThrow,
  loadWhatsAppSidianProviderFromEnv,
} from "./providers/whatsapp-sidian";
export type {
  ProviderRegistry,
  WhatsAppSidianProviderConfig,
} from "./providers/whatsapp-sidian";

export { createMemoryCommunicationChannelRepository } from "./test-fixtures/memory-repository";

export {
  buildOutboundIdempotencyKey,
  guideRecipientReference,
} from "./outbound/idempotency";
export { createOutboundMessageService } from "./outbound/service";
export type { QueueGuidePaymentConfirmationInput } from "./outbound/service";
export {
  processOutboundMessage,
  processQueuedOutboundBatch,
} from "./outbound/processor";
export { createMemoryCommunicationMessageRepository } from "./outbound/memory-repository";
export { createSupabaseCommunicationMessageRepository } from "./outbound/supabase-message-repository";
export type {
  MessagePersistenceClient,
  MessagePostgrestError,
} from "./outbound/supabase-message-repository";
export {
  canTransitionMessageStatus,
  COMMUNICATION_MESSAGE_STATUSES,
  MAX_SEND_ATTEMPTS,
} from "./outbound/types";
export type {
  CommunicationMessageRecord,
  CommunicationMessageRepository,
  CommunicationMessageStatus,
  ClaimOutboundBatchParams,
} from "./outbound/types";

export { loadWhatsAppEnv, isWhatsAppProviderEnabled } from "./whatsapp/env";
export type { WhatsAppEnv, WhatsAppTransportMode } from "./whatsapp/env";
export {
  createWhatsAppTransportFromEnv,
  createStubWhatsAppTransport,
  createGraphWhatsAppTransport,
  isWhatsAppTransportError,
  WhatsAppTransportError,
} from "./whatsapp/transport";
export {
  resolveCommunicationTemplate,
  buildGraphTemplateBody,
  COMMUNICATION_TEMPLATE_KEYS,
} from "./whatsapp/templates/registry";
export type { CommunicationTemplateKey } from "./whatsapp/templates/registry";

export {
  COMMUNICATION_ACTION_KEYS,
  mapProviderActionIdToKey,
  isCommunicationActionKey,
} from "./inbound/actions";
export type { CommunicationActionKey } from "./inbound/actions";
export { createInboundCommunicationService } from "./inbound/service";
export {
  createMemoryInboundMessageRepository,
  createMemoryInteractionSessionRepository,
  createMemoryGuidePaymentConfirmationRepository,
} from "./inbound/memory-repositories";
export { createMemoryIdentityDirectory } from "./inbound/identity";
export { parseFrenchEuroAmount } from "./inbound/amount-parser";
export { mapExactTextToAction } from "./inbound/text-fallback";
export {
  parseWhatsAppInboundMessages,
  hasInboundMessages,
} from "./whatsapp/inbound";
export {
  createLiveWhatsAppWebhookDeps,
} from "./whatsapp/webhook/create-live-deps";
export type {
  CreateLiveWhatsAppWebhookDepsInput,
  WhatsAppLivePersistenceClient,
  WhatsAppWebhookRuntimeDeps,
} from "./whatsapp/webhook/create-live-deps";
export {
  assertLiveWebhookPersistence,
  createSupabaseWebhookEventRepository,
} from "./whatsapp/webhook/supabase-webhook-event-repository";
export {
  createSupabaseInboundMessageRepository,
  createSupabaseInteractionSessionRepository,
  createSupabaseGuidePaymentConfirmationRepository,
} from "./inbound/supabase-repositories";
