/**
 * notification.generate_draft — brouillon déterministe, jamais d’envoi.
 *
 * Templates alignés email P0 + guide_payment_confirmation (WhatsApp G1-P).
 * L’envoi Guide réel passe par `guide-confirmation.ts` (outbox), pas par ce tool.
 */

import { NotificationRuntimeError } from "./errors";
import {
  isNotificationDraftTemplateId,
  type CreanceLookup,
  type CreanceSnapshot,
  type NotificationDraftResult,
  type NotificationDraftTemplateId,
} from "./types";

export type NotificationDraftService = {
  generateDraft(input: {
    tenantId: string;
    invoiceId: string;
    templateId: string;
    locale?: string;
  }): Promise<NotificationDraftResult>;
};

function formatAmountEur(cents: number): string {
  const euros = (cents / 100).toFixed(2).replace(".", ",");
  return `${euros} €`;
}

function buildPreview(
  templateId: NotificationDraftTemplateId,
  creance: CreanceSnapshot,
): string {
  const amount = formatAmountEur(creance.amountCents);
  const client = creance.clientName?.trim() || "votre client";
  const due = creance.dueDate;
  const label = creance.libelle?.trim();

  switch (templateId) {
    case "reminder_before_due":
      return label
        ? `Rappel : le paiement « ${label} » de ${amount} arrive à échéance le ${due} (${client}).`
        : `Rappel : un paiement de ${amount} arrive à échéance le ${due} (${client}).`;
    case "reminder_after_due":
      return `Échéance dépassée : ${amount} attendu depuis le ${due} (${client}).`;
    case "payment_received":
      return `Confirmation : un règlement de ${amount} a été enregistré pour ${client}.`;
    case "payment_failed":
      return `Échec de règlement : la tentative pour ${amount} (${client}) n’a pas abouti.`;
    case "update_payment_method":
      return `Action requise : mettre à jour le moyen de paiement pour ${amount} (${client}).`;
    case "cancellation_notice":
      return `Information : le suivi du paiement ${amount} (${client}) a été annulé.`;
    case "partial_payment_notice":
      return `Paiement partiel : un règlement partiel a été enregistré sur ${amount} (${client}).`;
    case "guide_internal_notice":
      return `Notice Guide : vérifier le paiement ${amount} pour ${client} (échéance ${due}).`;
    case "guide_payment_confirmation":
      return `Confirmation Guide : ${client} — ${amount} — répondre Oui / Non / Paiement partiel / Je vérifie.`;
    default: {
      const _exhaustive: never = templateId;
      return _exhaustive;
    }
  }
}

export function createNotificationDraftService(
  lookup: CreanceLookup,
): NotificationDraftService {
  return {
    async generateDraft(input) {
      const invoiceId = input.invoiceId?.trim() ?? "";
      const templateId = input.templateId?.trim() ?? "";

      if (!invoiceId || !templateId) {
        throw new NotificationRuntimeError({
          category: "business",
          code: "INVALID_ARGUMENT",
          message: "draft_args_required",
          userMessage: "Identifiant ou modèle de notification manquant.",
        });
      }

      if (!isNotificationDraftTemplateId(templateId)) {
        throw new NotificationRuntimeError({
          category: "business",
          code: "TEMPLATE_UNKNOWN",
          message: `template_unknown:${templateId}`,
          userMessage: "Modèle de notification non reconnu.",
        });
      }

      const locale = (input.locale ?? "fr").trim().toLowerCase();
      if (locale !== "fr") {
        throw new NotificationRuntimeError({
          category: "business",
          code: "INVALID_ARGUMENT",
          message: "locale_unsupported",
          userMessage: "Seule la locale fr est supportée au MVP.",
        });
      }

      let snapshot;
      try {
        snapshot = await lookup.findById(input.tenantId, invoiceId);
      } catch {
        throw new NotificationRuntimeError({
          category: "technical",
          code: "NOTIFICATION_RUNTIME_UNAVAILABLE",
          message: "creance_lookup_failed",
          userMessage: "Le brouillon est temporairement indisponible.",
        });
      }

      if (!snapshot) {
        throw new NotificationRuntimeError({
          category: "business",
          code: "INVOICE_NOT_FOUND",
          message: "creance_not_found",
          userMessage: "Paiement à recevoir introuvable.",
        });
      }

      return {
        template_id: templateId,
        body_preview: buildPreview(templateId, snapshot),
      };
    },
  };
}
