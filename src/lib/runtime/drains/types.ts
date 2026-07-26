/**
 * P0 Runtime — types partagés des drains outbox.
 * Aucune dépendance fournisseur. Horloge injectable.
 */

export const DRAIN_KINDS = [
  "whatsapp_outbound",
  "email_outbound",
  "payment_connect_audit",
  "notification_outbound",
] as const;

export type DrainKind = (typeof DRAIN_KINDS)[number];

export const DRAIN_ITEM_OUTCOMES = [
  "delivered",
  "retryable",
  "dead_letter",
  "skipped",
  "lease_lost",
] as const;

export type DrainItemOutcome = (typeof DRAIN_ITEM_OUTCOMES)[number];

export type DrainBatchResult = {
  kind: DrainKind;
  claimed: number;
  delivered: number;
  retryable: number;
  deadLetter: number;
  skipped: number;
  leaseLost: number;
  errors: number;
  durationMs: number;
  /** Horodatage injecté (ISO). */
  ranAt: string;
};

export type DrainItemResult = {
  id: string;
  idempotencyKey?: string;
  outcome: DrainItemOutcome;
  errorCode?: string;
  retryable?: boolean;
};

export type DrainRunOptions = {
  /** Taille max du lot (défaut par drain). */
  limit?: number;
  /** Durée de lease en secondes. */
  leaseSeconds?: number;
  /** Horloge injectée — jamais Date.now() implicite côté tests. */
  now?: () => Date;
};

export type OutboxDrain = {
  readonly kind: DrainKind;
  run(options?: DrainRunOptions): Promise<DrainBatchResult>;
};

export type DrainObservabilityEvent = {
  schemaVersion: "1";
  kind: DrainKind;
  occurredAt: string;
  outcome: DrainItemOutcome | "batch_complete" | "batch_failed";
  itemId?: string;
  idempotencyKeyHash?: string;
  errorCode?: string;
  claimed?: number;
  delivered?: number;
  retryable?: number;
  deadLetter?: number;
  durationMs?: number;
};

export type DrainObservabilitySink = {
  record(event: DrainObservabilityEvent): Promise<void>;
};

export const DEFAULT_DRAIN_BATCH_LIMIT = 10;
export const DEFAULT_DRAIN_LEASE_SECONDS = 60;
export const DEFAULT_MAX_ATTEMPTS = 4;
