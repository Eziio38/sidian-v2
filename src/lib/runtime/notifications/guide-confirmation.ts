/**
 * Enqueue confirmation Guide — canal documenté WhatsApp G1-P
 * (`guide_payment_confirmation`), pas d’émission email client ici.
 *
 * Utilisé par scanners / workers (P0 Runtime). Pas un tool agent d’envoi :
 * `notification.generate_draft` reste brouillon-only.
 */

import type {
  OutboundMessageService,
  QueueGuidePaymentConfirmationInput,
} from "@/lib/communication-channels/outbound/service";
import type { CommunicationMessageRecord } from "@/lib/communication-channels/outbound/types";
import { CommunicationChannelError } from "@/lib/communication-channels/errors";

import { NotificationRuntimeError } from "./errors";

export type GuideNotificationService = {
  enqueuePaymentConfirmation(
    input: QueueGuidePaymentConfirmationInput,
  ): Promise<CommunicationMessageRecord>;
};

/**
 * Wrapper déterministe autour de l’outbox WhatsApp existante.
 * Fail-closed si le service outbound n’est pas injecté / mal configuré.
 */
export function createGuideNotificationService(deps: {
  outbound: OutboundMessageService | null;
}): GuideNotificationService {
  return {
    async enqueuePaymentConfirmation(input) {
      if (!deps.outbound) {
        throw new NotificationRuntimeError({
          category: "technical",
          code: "GUIDE_ENQUEUE_UNAVAILABLE",
          message: "guide_outbound_not_configured",
          userMessage: "La notification Guide est indisponible.",
        });
      }

      try {
        return await deps.outbound.queueGuidePaymentConfirmation(input);
      } catch (err) {
        if (err instanceof CommunicationChannelError) {
          throw new NotificationRuntimeError({
            category: "technical",
            code: "GUIDE_ENQUEUE_UNAVAILABLE",
            message: err.message || err.code,
            userMessage: "La notification Guide n’a pas pu être mise en file.",
          });
        }
        throw new NotificationRuntimeError({
          category: "technical",
          code: "GUIDE_ENQUEUE_UNAVAILABLE",
          message: "guide_enqueue_failed",
          userMessage: "La notification Guide n’a pas pu être mise en file.",
        });
      }
    },
  };
}
