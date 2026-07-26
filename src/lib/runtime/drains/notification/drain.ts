/**
 * Notification outbox — hors MVP delivery.
 * L’outil agent `notification.generate_draft` produit des brouillons,
 * pas une file d’envoi. Drain stub documenté pour le cron inventory.
 */

import type { DrainBatchResult, DrainRunOptions, OutboxDrain } from "../types";
import { emptyBatchResult } from "../observability";

export const NOTIFICATION_OUTBOX_MVP_STATUS = "not_in_mvp" as const;

export type NotificationOutboxRecord = {
  id: string;
  tenantId: string;
  idempotencyKey: string;
  kind: string;
  status: "queued" | "sending" | "delivered" | "dead_letter";
  attemptCount: number;
  leaseToken: string | null;
};

export type NotificationOutboxRepository = {
  claimBatch(params: {
    limit: number;
    leaseSeconds?: number;
  }): Promise<NotificationOutboxRecord[]>;
};

/**
 * Drain no-op MVP : ne claim rien, expose le statut pour le cron.
 */
export function createNotificationOutboxDrainStub(): OutboxDrain & {
  mvpStatus: typeof NOTIFICATION_OUTBOX_MVP_STATUS;
} {
  return {
    kind: "notification_outbound",
    mvpStatus: NOTIFICATION_OUTBOX_MVP_STATUS,
    async run(options: DrainRunOptions = {}): Promise<DrainBatchResult> {
      const now = (options.now ?? (() => new Date()))().toISOString();
      return emptyBatchResult("notification_outbound", now);
    },
  };
}

export function createNotificationOutboxDrainFromEnv(): OutboxDrain {
  return createNotificationOutboxDrainStub();
}
