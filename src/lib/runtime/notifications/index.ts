/**
 * P0 Runtime — notifications / lecture créance (alias invoice) / Guide outbox.
 *
 * Périmètre documenté (01/02/03) :
 * - lecture créance via invoice.get (pas d’émission facture) ;
 * - brouillon notification déterministe (pas d’envoi) ;
 * - enqueue confirmation Guide WhatsApp (G1-P) pour workers.
 *
 * Explicitement hors scope : émission légale, sync Pennylane, exports comptables.
 */

export {
  NOTIFICATION_RUNTIME_ERROR_CODES,
  NotificationRuntimeError,
  isNotificationRuntimeError,
} from "./errors";
export type {
  NotificationRuntimeErrorCode,
  NotificationRuntimeErrorCategory,
} from "./errors";

export {
  NOTIFICATION_DRAFT_TEMPLATE_IDS,
  OUT_OF_SCOPE_P0,
  isNotificationDraftTemplateId,
} from "./types";
export type {
  CreanceLookup,
  CreanceSnapshot,
  InvoiceGetResult,
  NotificationDraftResult,
  NotificationDraftTemplateId,
} from "./types";

export {
  createMemoryCreanceLookup,
  createSupabaseCreanceLookup,
} from "./creance-lookup";
export type { CreanceLookupClient } from "./creance-lookup";

export { createInvoiceGetService } from "./invoice-get";
export type { InvoiceGetService } from "./invoice-get";

export { createNotificationDraftService } from "./notification-draft";
export type { NotificationDraftService } from "./notification-draft";

export { createGuideNotificationService } from "./guide-confirmation";
export type { GuideNotificationService } from "./guide-confirmation";

export { createNotificationRuntimeExecutors } from "./executors";
