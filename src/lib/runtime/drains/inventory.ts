/**
 * Inventaire des drains P0 + contrat d’appel cron (SOUS-AGENT G).
 */

import type { DrainKind, OutboxDrain } from "./types";

export type DrainInventoryEntry = {
  kind: DrainKind;
  /** Identifiant stable pour routes cron. */
  cronJobId: string;
  /** MVP : actif ou différé. */
  mvpStatus: "active" | "deferred" | "not_in_mvp";
  /** Factory FromEnv recommandée. */
  fromEnvExport: string;
  /** Table / RPC SQL source. */
  persistence: string;
  notes: string;
};

export const DRAIN_INVENTORY: readonly DrainInventoryEntry[] = [
  {
    kind: "whatsapp_outbound",
    cronJobId: "drain-whatsapp-outbound",
    mvpStatus: "active",
    fromEnvExport: "createWhatsAppOutboxDrainFromEnv",
    persistence:
      "communication_messages + claim_communication_outbound_batch / complete|fail_communication_outbound_claim",
    notes:
      "Réutilise processOutboundMessage. Live = Supabase service_role uniquement.",
  },
  {
    kind: "email_outbound",
    cronJobId: "drain-email-outbound",
    mvpStatus: "active",
    fromEnvExport: "createEmailOutboxDrainFromEnv",
    persistence:
      "email_outbox + claim_email_outbox_batch (lease) ; processQueuedEmailBatch (module Email)",
    notes:
      "Drain runtime sur module Email (A). Live = Supabase + provider FromEnv, jamais mémoire.",
  },
  {
    kind: "payment_connect_audit",
    cronJobId: "drain-payment-connect-audit",
    mvpStatus: "active",
    fromEnvExport: "createPaymentConnectAuditOutboxDrainFromEnv",
    persistence:
      "stripe_connect_audit_outbox + drain_stripe_connect_audit_outbox_batch",
    notes:
      "Seul outbox paiement MVP (audit Connect → audit_log). Tentatives paiement = webhooks, pas outbox.",
  },
  {
    kind: "notification_outbound",
    cronJobId: "drain-notification-outbound",
    mvpStatus: "not_in_mvp",
    fromEnvExport: "createNotificationOutboxDrainFromEnv",
    persistence: "aucune (brouillons agent notification.generate_draft seulement)",
    notes: "Pas de file d’envoi notification au MVP. Drain no-op documenté.",
  },
] as const;

/**
 * Contrat d’appel pour le cron (SOUS-AGENT G) :
 *
 * ```ts
 * import {
 *   createWhatsAppOutboxDrainFromEnv,
 *   createEmailOutboxDrainFromEnv,
 *   createPaymentConnectAuditOutboxDrainFromEnv,
 *   createNotificationOutboxDrainFromEnv,
 *   runAllActiveDrains,
 * } from "@/lib/runtime/drains";
 *
 * // Route sécurisée (Bearer cron secret) — un job ou fan-out :
 * await runAllActiveDrains({ limit: 25, leaseSeconds: 60 });
 * // ou unitaire :
 * const drain = await createWhatsAppOutboxDrainFromEnv();
 * await drain.run({ limit: 25 });
 * ```
 */
export type RunAllActiveDrainsOptions = {
  limit?: number;
  leaseSeconds?: number;
  now?: () => Date;
  drains?: OutboxDrain[];
};

export async function runAllActiveDrains(
  options: RunAllActiveDrainsOptions & {
    /** Factories déjà résolues (FromEnv côté cron). */
    drains: OutboxDrain[];
  },
) {
  const results = [];
  for (const drain of options.drains) {
    results.push(
      await drain.run({
        limit: options.limit,
        leaseSeconds: options.leaseSeconds,
        now: options.now,
      }),
    );
  }
  return results;
}
