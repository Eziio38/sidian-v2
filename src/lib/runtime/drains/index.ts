/**
 * P0 Runtime — Outbox drains.
 *
 * Les factories *FromEnv (server-only) sont exportées depuis ./from-env.
 */

export type {
  DrainBatchResult,
  DrainItemOutcome,
  DrainItemResult,
  DrainKind,
  DrainObservabilityEvent,
  DrainObservabilitySink,
  DrainRunOptions,
  OutboxDrain,
} from "./types";
export {
  DRAIN_KINDS,
  DRAIN_ITEM_OUTCOMES,
  DEFAULT_DRAIN_BATCH_LIMIT,
  DEFAULT_DRAIN_LEASE_SECONDS,
  DEFAULT_MAX_ATTEMPTS,
} from "./types";

export {
  computeRetryDelaySeconds,
  isPermanentErrorCode,
} from "./backoff";

export {
  createNullDrainObservabilitySink,
  createMemoryDrainObservabilitySink,
  hashIdempotencyKey,
  emptyBatchResult,
} from "./observability";

export { createWhatsAppOutboxDrain } from "./whatsapp/drain";
export type { WhatsAppOutboxDrainDeps } from "./whatsapp/drain";

export { createEmailOutboxDrain } from "./email/drain";
export type { EmailOutboxDrainDeps } from "./email/drain";
export { claimEmailOutboxBatchSql } from "./email/claim-sql";
export type { EmailClaimClient } from "./email/claim-sql";

export { createPaymentConnectAuditOutboxDrain } from "./payment/drain";
export type {
  PaymentConnectAuditDrainClient,
  PaymentConnectAuditDrainDeps,
} from "./payment/drain";

export {
  createNotificationOutboxDrainStub,
  createNotificationOutboxDrainFromEnv,
  NOTIFICATION_OUTBOX_MVP_STATUS,
} from "./notification/drain";

export {
  DRAIN_INVENTORY,
  runAllActiveDrains,
} from "./inventory";
export type {
  DrainInventoryEntry,
  RunAllActiveDrainsOptions,
} from "./inventory";
