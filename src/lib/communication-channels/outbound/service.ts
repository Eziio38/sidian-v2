import type { CommunicationChannelRepository } from "../types";
import { resolveCommunicationChannel } from "../resolve";
import { CommunicationChannelError } from "../errors";
import { assertNoPhoneInBusinessInput } from "../service";
import {
  buildOutboundIdempotencyKey,
  guideRecipientReference,
} from "./idempotency";
import type {
  CommunicationMessageRecord,
  CommunicationMessageRepository,
} from "./types";
import {
  buildGraphTemplateBody,
  resolveCommunicationTemplate,
  type GuidePaymentConfirmationVariables,
} from "../whatsapp/templates/registry";
import { buildOutboundBusinessReference } from "../inbound/correlation";

export type QueueGuidePaymentConfirmationInput = {
  tenantId: string;
  /** Protection / créance liée à la confirmation. */
  protectionId: string;
  /** Occurrence planifiée (ex. date ISO jour). */
  occurrenceKey: string;
  /** Montant dû en centimes — corrélation inbound G1-Q. */
  amountDueCents: number;
  channelId?: string;
  variables: GuidePaymentConfirmationVariables;
};

export type OutboundMessageService = {
  queueGuidePaymentConfirmation(
    input: QueueGuidePaymentConfirmationInput,
  ): Promise<CommunicationMessageRecord>;
};

/**
 * Enregistre l'intention d'envoi (queued) sans appeler le fournisseur.
 * Le destinataire technique (Graph `to`) vient de la config transport, pas du métier.
 */
export function createOutboundMessageService(deps: {
  channels: CommunicationChannelRepository;
  messages: CommunicationMessageRepository;
  /** Identifiant technique destinataire Guide (pas un E.164 métier). */
  guideRecipientTechnicalId: string;
}): OutboundMessageService {
  return {
    async queueGuidePaymentConfirmation(input) {
      assertNoPhoneInBusinessInput(
        input as unknown as Record<string, unknown>,
      );

      if (!deps.guideRecipientTechnicalId.trim()) {
        throw new CommunicationChannelError(
          "provider_misconfigured",
          "guide_recipient_technical_id_missing",
        );
      }

      if (
        !Number.isInteger(input.amountDueCents) ||
        input.amountDueCents <= 0
      ) {
        throw new CommunicationChannelError(
          "send_rejected",
          "amount_due_cents_invalid",
        );
      }

      const channel = await resolveCommunicationChannel(deps.channels, {
        prestataireId: input.tenantId,
        channelId: input.channelId,
        preferredProviderKind: "whatsapp_sidian",
      });

      if (channel.providerKind !== "whatsapp_sidian") {
        throw new CommunicationChannelError("provider_not_implemented");
      }

      const template = resolveCommunicationTemplate({
        templateKey: "guide_payment_confirmation",
        locale: "fr",
        variables: input.variables,
      });

      const recipientReference = guideRecipientReference(input.tenantId);
      const idempotencyKey = buildOutboundIdempotencyKey({
        tenantId: input.tenantId,
        eventType: "guide_payment_confirmation",
        entityId: input.protectionId,
        occurrenceKey: input.occurrenceKey,
        recipientReference,
      });

      const existing = await deps.messages.findByIdempotencyKey(
        input.tenantId,
        idempotencyKey,
      );
      if (existing) return existing;

      const graphBody = buildGraphTemplateBody({
        toTechnicalId: deps.guideRecipientTechnicalId,
        template,
      });

      const business = buildOutboundBusinessReference({
        protectionId: input.protectionId,
        occurrenceId: input.occurrenceKey,
        amountDueCents: input.amountDueCents,
        clientDisplayName: input.variables.clientName,
        amountLabel: input.variables.amountLabel,
      });

      return deps.messages.insertQueued({
        tenantId: input.tenantId,
        channelId: channel.id,
        providerKind: "whatsapp_sidian",
        recipientReference,
        messageKind: "template",
        templateKey: "guide_payment_confirmation",
        templateLocale: "fr",
        payloadSnapshot: {
          templateKey: "guide_payment_confirmation",
          locale: "fr",
          variables: input.variables,
          // graphBody sans `to` — destinataire injecté au send depuis env.
          graphBody,
          business,
        },
        idempotencyKey,
      });
    },
  };
}
