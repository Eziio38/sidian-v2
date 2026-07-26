export type {
  EmailDeliveryStatus,
  EmailLocale,
  EmailMessage,
  EmailOutboxRecord,
  EmailProviderKind,
  EmailRecipient,
  EmailRelatedEntityType,
  EmailTemplateKey,
} from "./types";
export {
  EMAIL_DELIVERY_STATUSES,
  EMAIL_LOCALES,
  EMAIL_MAX_SEND_ATTEMPTS,
  EMAIL_PROVIDER_KINDS,
  EMAIL_RELATED_ENTITY_TYPES,
  EMAIL_TEMPLATE_KEYS,
  canTransitionEmailStatus,
  isEmailTemplateKey,
} from "./types";

export {
  canonicalizeEmailAddress,
  canonicalizeOptionalDisplayName,
  hashEmailAddress,
} from "./address";

export { EmailError, isEmailError, EMAIL_ERROR_CODES } from "./errors";
export type { EmailErrorCode } from "./errors";

export {
  loadEmailEnv,
  isEmailProviderEnabled,
  EMAIL_TRANSPORT_MODES,
} from "./env";
export type { EmailEnv, EmailTransportMode } from "./env";

export { buildEmailIdempotencyKey } from "./idempotency";
export { logEmailEvent } from "./log";
export type { EmailLogContext } from "./log";

export { createEmailChannel } from "./channel";
export type { EmailChannel } from "./channel";

export {
  createEmailProviderFromEnv,
  createResendEmailProvider,
  createStubEmailProvider,
  isEmailProviderError,
  EmailProviderError,
} from "./provider";
export type {
  EmailProvider,
  EmailProviderSendResult,
  StubEmailProviderOptions,
  StubEmailProviderScenario,
  ResendEmailProviderConfig,
} from "./provider";

export { renderEmailTemplate } from "./templates/registry";
export type {
  RenderedEmailTemplate,
  TemplateVariablesByKey,
  ReminderBeforeDueVariables,
  ReminderAfterDueVariables,
  PaymentReceivedVariables,
  PaymentFailedVariables,
  UpdatePaymentMethodVariables,
  CancellationNoticeVariables,
  PartialPaymentNoticeVariables,
  GuideInternalNoticeVariables,
} from "./templates/registry";
export {
  escapeHtml,
  sanitizePlainText,
  assertSafeHttpsUrl,
} from "./templates/escape";

export { createEmailOutboxService } from "./outbox/service";
export type {
  EmailOutboxService,
  EnqueueEmailInput,
} from "./outbox/service";
export {
  processEmailOutboxRecord,
  processQueuedEmailBatch,
} from "./outbox/processor";
export type { ProcessEmailResult } from "./outbox/processor";
export type {
  EmailOutboxRepository,
  InsertEmailOutboxInput,
} from "./outbox/repository";
export { createMemoryEmailOutboxRepository } from "./outbox/memory-repository";
export { createSupabaseEmailOutboxRepository } from "./outbox/supabase-repository";
export type {
  EmailPersistenceClient,
  EmailPostgrestError,
} from "./outbox/supabase-repository";
