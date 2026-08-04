/**
 * Canal email en mémoire — double de test des handlers de relance.
 *
 * Il reproduit la seule propriété qui compte pour les handlers : l'unicité par
 * `(tenantId, idempotencyKey)`. Un rejeu doit retomber sur la même ligne, sans
 * créer de second envoi.
 */

import type { EmailTemplateKey } from "../../../email/types";
import type {
  RelanceEmailRequest,
  RelanceMailer,
  RelanceMailerStatus,
} from "../types";

export type MemoryRelanceMailer = RelanceMailer & {
  /** Envois retenus, dans l'ordre d'enfilement (dédoublonnés). */
  sent: Array<RelanceEmailRequest<EmailTemplateKey> & { outboxId: string }>;
  /** Toutes les demandes reçues, doublons compris. */
  calls: Array<RelanceEmailRequest<EmailTemplateKey>>;
  setStatus: (status: RelanceMailerStatus) => void;
  reset: () => void;
};

export function createMemoryRelanceMailer(
  initialStatus: RelanceMailerStatus = { available: true },
): MemoryRelanceMailer {
  const sent: MemoryRelanceMailer["sent"] = [];
  const calls: MemoryRelanceMailer["calls"] = [];
  let status = initialStatus;
  let seq = 0;

  return {
    sent,
    calls,
    setStatus(next) {
      status = next;
    },
    reset() {
      sent.length = 0;
      calls.length = 0;
      seq = 0;
    },
    status() {
      return status;
    },
    async enqueue(request) {
      if (!status.available) {
        // Le handler ne doit jamais atteindre ce point : la porte d'honnêteté
        // est en amont. On lève pour que le test le prouve.
        throw new Error(`memory_mailer_unavailable:${status.errorCode}`);
      }
      const typed = request as RelanceEmailRequest<EmailTemplateKey>;
      calls.push(typed);
      const existing = sent.find(
        (row) =>
          row.tenantId === typed.tenantId &&
          row.idempotencyKey === typed.idempotencyKey,
      );
      if (existing) return { outboxId: existing.outboxId };

      seq += 1;
      const outboxId = `email_${seq}`;
      sent.push({ ...typed, outboxId });
      return { outboxId };
    },
  };
}
