/**
 * G1-Q — Communication inbound service.
 * Webhook → messages normalisés → corrélation outbound → commandes domaine.
 * Aucun payload Meta / numéro / Graph dans le domaine.
 */

import type { CommunicationMessageRepository } from "../outbound/types";
import type { OutboundMessageService } from "../outbound/service";
import {
  buildOutboundIdempotencyKey,
  guideRecipientReference,
} from "../outbound/idempotency";
import { applyGuidePaymentCommand } from "./domain/apply";
import type { GuidePaymentDomainEvent } from "./domain/types";
import { mapProviderActionIdToKey, type CommunicationActionKey } from "./actions";
import { extractOutboundBusinessReference } from "./correlation";
import { buildBusinessCommandIdempotencyKey } from "./idempotency";
import {
  authorizeGuideForTenant,
  type CommunicationIdentityDirectory,
} from "./identity";
import { parseFrenchEuroAmount, formatEuroFromCents } from "./amount-parser";
import { mapExactTextToAction, normalizeActionText } from "./text-fallback";
import type {
  GuidePaymentConfirmationRepository,
  InboundMessageRepository,
  InteractionSessionRepository,
} from "./repositories";
import type {
  InboundCommunicationMessage,
  InboundMessageRecord,
} from "./types";

const PARTIAL_SESSION_TTL_MS = 30 * 60 * 1000;
const PARTIAL_MAX_ATTEMPTS = 3;
/** Boutons / actions interactives : 7 jours (consultable, domaine refuse si état incompatible). */
export const INTERACTIVE_ACTION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type InboundProcessResult = {
  inboundMessageId: string;
  processingStatus: InboundMessageRecord["processingStatus"];
  actionKey: CommunicationActionKey | null;
  businessCommandId: string | null;
  domainEvent: GuidePaymentDomainEvent | null;
  confirmationQueued: boolean;
  detail?: string;
};

export type CreateInboundCommunicationServiceDeps = {
  inbound: InboundMessageRepository;
  sessions: InteractionSessionRepository;
  confirmations: GuidePaymentConfirmationRepository;
  outboundMessages: CommunicationMessageRepository;
  identities: CommunicationIdentityDirectory;
  /** Pour confirmations WhatsApp post-action (G1-P). */
  outboundService?: OutboundMessageService;
  guideRecipientTechnicalId?: string;
  now?: () => Date;
};

function addMs(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

export function createInboundCommunicationService(
  deps: CreateInboundCommunicationServiceDeps,
) {
  const now = () => (deps.now ? deps.now() : new Date());

  async function queueGuideConfirmationText(params: {
    tenantId: string;
    channelId: string;
    protectionId: string;
    occurrenceKey: string;
    text: string;
    idempotencySuffix: string;
  }): Promise<boolean> {
    if (!deps.guideRecipientTechnicalId) {
      return false;
    }
    const recipientReference = guideRecipientReference(params.tenantId);
    const idempotencyKey = buildOutboundIdempotencyKey({
      tenantId: params.tenantId,
      eventType: "guide_payment_ack",
      entityId: params.protectionId,
      occurrenceKey: `${params.occurrenceKey}:${params.idempotencySuffix}`,
      recipientReference,
    });

    // Confirmation textuelle via message template-like snapshot (free text body).
    await deps.outboundMessages.insertQueued({
      tenantId: params.tenantId,
      channelId: params.channelId,
      providerKind: "whatsapp_sidian",
      recipientReference,
      messageKind: "text",
      templateKey: "guide_payment_ack",
      templateLocale: "fr",
      payloadSnapshot: {
        kind: "text_confirmation",
        body: params.text,
        // Sans `to` / toTechnicalId — injectés au send depuis env adaptateur.
        graphBody: {
          messaging_product: "whatsapp",
          type: "text",
          text: { body: params.text },
        },
      },
      idempotencyKey,
    });
    return true;
  }

  async function resolveAction(
    message: InboundCommunicationMessage,
  ): Promise<
    | { actionKey: CommunicationActionKey; via: "button" | "text" }
    | { actionKey: null; reject: "unknown_action" | "ambiguous_text" }
  > {
    if (message.interaction.kind === "button") {
      return { actionKey: message.interaction.actionKey, via: "button" };
    }
    const mapped = mapExactTextToAction(message.interaction.text);
    if (mapped) return { actionKey: mapped, via: "text" };
    return { actionKey: null, reject: "ambiguous_text" };
  }

  return {
    /**
     * Traite un message inbound déjà authentifié / parsé (hors HTTP).
     */
    async processInboundMessage(
      message: InboundCommunicationMessage,
    ): Promise<InboundProcessResult> {
      const receivedAt = message.sentAt.toISOString();
      const actionFromButton =
        message.interaction.kind === "button"
          ? message.interaction.actionKey
          : null;
      const normalizedText =
        message.interaction.kind === "text"
          ? normalizeActionText(message.interaction.text)
          : null;

      const inserted = await deps.inbound.tryInsert({
        providerKind: message.providerKind,
        providerEventId: message.providerEventId,
        providerMessageId: message.providerMessageId,
        replyToProviderMessageId: message.replyToProviderMessageId,
        senderReference: message.senderReference,
        interactionKind: message.interaction.kind,
        actionKey: actionFromButton,
        normalizedText,
        payloadSnapshot: message.safePayloadSnapshot,
        receivedAt,
      });

      if (inserted.outcome === "duplicate") {
        return {
          inboundMessageId: inserted.record.id,
          processingStatus: inserted.record.processingStatus,
          actionKey: inserted.record.actionKey,
          businessCommandId: inserted.record.businessCommandId,
          domainEvent: null,
          confirmationQueued: false,
          detail: "duplicate",
        };
      }

      const claimed = await deps.inbound.claimForProcessing(inserted.record.id);
      if (!claimed) {
        return {
          inboundMessageId: inserted.record.id,
          processingStatus: inserted.record.processingStatus,
          actionKey: inserted.record.actionKey,
          businessCommandId: inserted.record.businessCommandId,
          domainEvent: null,
          confirmationQueued: false,
          detail: "not_claimable",
        };
      }

      // Corrélation obligatoire via reply context → outbound.provider_message_id
      // Exception contrôlée : session partielle active (montant) sans reply.
      if (!message.replyToProviderMessageId) {
        const bySender = deps.identities.resolveBySender
          ? await deps.identities.resolveBySender({
              senderReference: message.senderReference,
            })
          : null;
        if (bySender?.active && bySender.canConfirmPayments) {
          const session = await deps.sessions.findActive({
            tenantId: bySender.tenantId,
            channelId: bySender.channelId,
            guideId: bySender.guideId,
            now: now().toISOString(),
          });
          if (session && message.interaction.kind === "text") {
            const outboundById = await deps.outboundMessages.findById?.(
              session.outboundMessageId,
            );
            // Fallback: scan via findByProviderMessageId not available — require findById
            if (outboundById) {
              const business = extractOutboundBusinessReference(
                outboundById.payloadSnapshot,
              );
              if (business) {
                await deps.inbound.update({
                  id: claimed.id,
                  tenantId: bySender.tenantId,
                  channelId: bySender.channelId,
                  processingStatus: "correlated",
                  correlatedOutboundMessageId: outboundById.id,
                });
                return processPartialAmountText({
                  claimedId: claimed.id,
                  outbound: outboundById,
                  business,
                  guideId: bySender.guideId,
                  session,
                  rawText: message.interaction.text,
                });
              }
            }
          }
        }

        const unresolved = await deps.inbound.update({
          id: claimed.id,
          processingStatus: "unresolved",
          failureCode: "missing_reply_context",
          failureMessage: "reply_context_absent",
          failedAt: now().toISOString(),
        });
        return {
          inboundMessageId: unresolved.id,
          processingStatus: "unresolved",
          actionKey: null,
          businessCommandId: null,
          domainEvent: null,
          confirmationQueued: false,
          detail: "missing_reply_context",
        };
      }

      const outbound = await deps.outboundMessages.findByProviderMessageId(
        message.providerKind,
        message.replyToProviderMessageId,
      );

      if (!outbound) {
        const unresolved = await deps.inbound.update({
          id: claimed.id,
          processingStatus: "unresolved",
          failureCode: "outbound_not_found",
          failureMessage: "correlated_outbound_missing",
          failedAt: now().toISOString(),
        });
        return {
          inboundMessageId: unresolved.id,
          processingStatus: "unresolved",
          actionKey: null,
          businessCommandId: null,
          domainEvent: null,
          confirmationQueued: false,
          detail: "outbound_not_found",
        };
      }

      const business = extractOutboundBusinessReference(outbound.payloadSnapshot);
      if (!business) {
        const unresolved = await deps.inbound.update({
          id: claimed.id,
          tenantId: outbound.tenantId,
          channelId: outbound.channelId,
          processingStatus: "unresolved",
          correlatedOutboundMessageId: outbound.id,
          failureCode: "business_reference_missing",
          failureMessage: "outbound_business_reference_invalid",
          failedAt: now().toISOString(),
        });
        return {
          inboundMessageId: unresolved.id,
          processingStatus: "unresolved",
          actionKey: null,
          businessCommandId: null,
          domainEvent: null,
          confirmationQueued: false,
          detail: "business_reference_missing",
        };
      }

      // Tenant uniquement depuis outbound persisté
      const identity = await deps.identities.resolve({
        channelId: outbound.channelId,
        senderReference: message.senderReference,
      });
      const auth = authorizeGuideForTenant({
        identity,
        tenantId: outbound.tenantId,
      });
      if (!auth.ok) {
        const rejected = await deps.inbound.update({
          id: claimed.id,
          tenantId: outbound.tenantId,
          channelId: outbound.channelId,
          processingStatus: "rejected",
          correlatedOutboundMessageId: outbound.id,
          failureCode: auth.reason,
          failureMessage: "guide_not_authorized",
          failedAt: now().toISOString(),
        });
        return {
          inboundMessageId: rejected.id,
          processingStatus: "rejected",
          actionKey: null,
          businessCommandId: null,
          domainEvent: null,
          confirmationQueued: false,
          detail: auth.reason,
        };
      }

      await deps.inbound.update({
        id: claimed.id,
        tenantId: outbound.tenantId,
        channelId: outbound.channelId,
        processingStatus: "correlated",
        correlatedOutboundMessageId: outbound.id,
      });

      // Expiration interactive (temps) — le domaine reste toujours la source d'autorité
      const outboundAgeMs =
        now().getTime() - new Date(outbound.createdAt).getTime();
      if (outboundAgeMs > INTERACTIVE_ACTION_MAX_AGE_MS) {
        const rejected = await deps.inbound.update({
          id: claimed.id,
          processingStatus: "rejected",
          failureCode: "interaction_expired",
          failureMessage: "interactive_action_expired",
          failedAt: now().toISOString(),
        });
        return {
          inboundMessageId: rejected.id,
          processingStatus: "rejected",
          actionKey: null,
          businessCommandId: null,
          domainEvent: null,
          confirmationQueued: false,
          detail: "interaction_expired",
        };
      }

      // Session partielle : texte = montant
      const activeSession = await deps.sessions.findActive({
        tenantId: outbound.tenantId,
        channelId: outbound.channelId,
        guideId: auth.identity.guideId,
        now: now().toISOString(),
      });

      if (
        activeSession &&
        message.interaction.kind === "text" &&
        !mapExactTextToAction(message.interaction.text)
      ) {
        return processPartialAmountText({
          claimedId: claimed.id,
          outbound,
          business,
          guideId: auth.identity.guideId,
          session: activeSession,
          rawText: message.interaction.text,
        });
      }

      const resolved = await resolveAction(message);
      if (!resolved.actionKey) {
        // Bouton inconnu déjà filtré au parse ; texte ambigu
        const rejected = await deps.inbound.update({
          id: claimed.id,
          processingStatus: "rejected",
          failureCode: resolved.reject,
          failureMessage: "action_unresolved",
          failedAt: now().toISOString(),
        });
        // Demander d'utiliser les boutons (idempotent)
        await queueGuideConfirmationText({
          tenantId: outbound.tenantId,
          channelId: outbound.channelId,
          protectionId: business.businessEntityId,
          occurrenceKey: business.businessOccurrenceId,
          text: "Je n’ai pas compris. Utilise les boutons Oui / Non / Paiement partiel / Je vérifie.",
          idempotencySuffix: `ambiguous:${claimed.id}`,
        });
        return {
          inboundMessageId: rejected.id,
          processingStatus: "rejected",
          actionKey: null,
          businessCommandId: null,
          domainEvent: null,
          confirmationQueued: true,
          detail: resolved.reject,
        };
      }

      const actionKey = resolved.actionKey;

      if (actionKey === "payment_received_partial") {
        return startPartialSession({
          claimedId: claimed.id,
          outbound,
          business,
          guideId: auth.identity.guideId,
          actionKey,
        });
      }

      return applyDirectAction({
        claimedId: claimed.id,
        outbound,
        business,
        guideId: auth.identity.guideId,
        actionKey,
      });
    },
  };

  async function startPartialSession(params: {
    claimedId: string;
    outbound: Awaited<
      ReturnType<CommunicationMessageRepository["findByProviderMessageId"]>
    > &
      object;
    business: NonNullable<ReturnType<typeof extractOutboundBusinessReference>>;
    guideId: string;
    actionKey: CommunicationActionKey;
  }): Promise<InboundProcessResult> {
    const outbound = params.outbound!;
    const at = now().toISOString();
    const commandId = buildBusinessCommandIdempotencyKey({
      tenantId: outbound.tenantId,
      outboundMessageId: outbound.id,
      actionKey: "payment_received_partial",
      interactionSequence: "start",
    });

    await deps.sessions.create({
      tenantId: outbound.tenantId,
      channelId: outbound.channelId,
      guideId: params.guideId,
      inboundMessageId: params.claimedId,
      outboundMessageId: outbound.id,
      sessionKind: "payment_partial_amount_collection",
      status: "awaiting_input",
      businessEntityType: params.business.businessEntityType,
      businessEntityId: params.business.businessEntityId,
      expectedInputKind: "amount_eur_cents",
      attemptCount: 0,
      maxAttempts: PARTIAL_MAX_ATTEMPTS,
      expiresAt: addMs(at, PARTIAL_SESSION_TTL_MS),
    });

    const confirmationQueued = await queueGuideConfirmationText({
      tenantId: outbound.tenantId,
      channelId: outbound.channelId,
      protectionId: params.business.businessEntityId,
      occurrenceKey: params.business.businessOccurrenceId,
      text: "Quel montant as-tu reçu ?",
      idempotencySuffix: `partial_ask:${commandId}`,
    });

    const processed = await deps.inbound.update({
      id: params.claimedId,
      processingStatus: "processed",
      actionKey: params.actionKey,
      businessCommandId: commandId,
      processedAt: at,
    });

    return {
      inboundMessageId: processed.id,
      processingStatus: "processed",
      actionKey: params.actionKey,
      businessCommandId: commandId,
      domainEvent: null,
      confirmationQueued,
      detail: "partial_session_started",
    };
  }

  async function processPartialAmountText(params: {
    claimedId: string;
    outbound: NonNullable<
      Awaited<ReturnType<CommunicationMessageRepository["findByProviderMessageId"]>>
    >;
    business: NonNullable<ReturnType<typeof extractOutboundBusinessReference>>;
    guideId: string;
    session: NonNullable<
      Awaited<ReturnType<InteractionSessionRepository["findActive"]>>
    >;
    rawText: string;
  }): Promise<InboundProcessResult> {
    const at = now().toISOString();
    const parsed = parseFrenchEuroAmount(params.rawText);

    if (!parsed.ok) {
      const session = await deps.sessions.incrementAttempts(params.session.id);
      if (session.attemptCount >= session.maxAttempts) {
        await deps.sessions.setStatus({
          id: session.id,
          status: "failed",
          at,
        });
        await queueGuideConfirmationText({
          tenantId: params.outbound.tenantId,
          channelId: params.outbound.channelId,
          protectionId: params.business.businessEntityId,
          occurrenceKey: params.business.businessOccurrenceId,
          text: "Je n’ai pas pu enregistrer le montant après plusieurs essais. Reprends l’action depuis Sidian.",
          idempotencySuffix: `partial_fail:${session.id}`,
        });
        const failed = await deps.inbound.update({
          id: params.claimedId,
          processingStatus: "failed",
          failureCode: parsed.reason,
          failureMessage: "partial_amount_max_attempts",
          failedAt: at,
        });
        return {
          inboundMessageId: failed.id,
          processingStatus: "failed",
          actionKey: "payment_received_partial",
          businessCommandId: null,
          domainEvent: null,
          confirmationQueued: true,
          detail: "partial_max_attempts",
        };
      }

      await queueGuideConfirmationText({
        tenantId: params.outbound.tenantId,
        channelId: params.outbound.channelId,
        protectionId: params.business.businessEntityId,
        occurrenceKey: params.business.businessOccurrenceId,
        text: "Je n’ai pas reconnu le montant. Réponds uniquement avec le montant reçu, par exemple 1 200 €.",
        idempotencySuffix: `partial_retry:${session.id}:${session.attemptCount}`,
      });

      const rejected = await deps.inbound.update({
        id: params.claimedId,
        processingStatus: "rejected",
        actionKey: "payment_received_partial",
        failureCode: parsed.reason,
        failureMessage: "partial_amount_parse_failed",
        failedAt: at,
      });
      return {
        inboundMessageId: rejected.id,
        processingStatus: "rejected",
        actionKey: "payment_received_partial",
        businessCommandId: null,
        domainEvent: null,
        confirmationQueued: true,
        detail: parsed.reason,
      };
    }

    const commandId = buildBusinessCommandIdempotencyKey({
      tenantId: params.outbound.tenantId,
      outboundMessageId: params.outbound.id,
      actionKey: "partial_amount",
      interactionSequence: `${parsed.amountCents}`,
    });

    const confirmation = await deps.confirmations.getOrCreate({
      tenantId: params.outbound.tenantId,
      protectionId: params.business.businessEntityId,
      occurrenceId: params.business.businessOccurrenceId,
      amountDueCents: params.business.amountDueCents,
      sourceOutboundMessageId: params.outbound.id,
      now: at,
    });

    const result = applyGuidePaymentCommand(confirmation, {
      type: "ApplyPartialPaymentReceived",
      tenantId: params.outbound.tenantId,
      protectionId: params.business.businessEntityId,
      occurrenceId: params.business.businessOccurrenceId,
      confirmedByGuideId: params.guideId,
      sourceOutboundMessageId: params.outbound.id,
      sourceInboundMessageId: params.claimedId,
      amountReceivedCents: parsed.amountCents,
      confirmedAt: at,
      idempotencyKey: commandId,
    });

    await deps.confirmations.save(result.record);

    if (result.outcome === "rejected") {
      const rejected = await deps.inbound.update({
        id: params.claimedId,
        processingStatus: "rejected",
        actionKey: "payment_received_partial",
        businessCommandId: commandId,
        failureCode: result.event.type === "GuidePaymentCommandRejected"
          ? result.event.reason
          : "rejected",
        failureMessage: "partial_domain_rejected",
        failedAt: at,
      });
      return {
        inboundMessageId: rejected.id,
        processingStatus: "rejected",
        actionKey: "payment_received_partial",
        businessCommandId: commandId,
        domainEvent: result.event,
        confirmationQueued: false,
        detail: "domain_rejected",
      };
    }

    await deps.sessions.setStatus({
      id: params.session.id,
      status: "completed",
      at,
    });

    const remaining =
      result.record.amountDueCents - result.record.amountReceivedCents;
    const ack =
      remaining === 0
        ? `C’est noté. Le règlement de ${params.business.amountLabel} de ${params.business.clientDisplayName} est marqué comme reçu.`
        : `C’est noté. ${formatEuroFromCents(parsed.amountCents)} ont été reçus. Il reste ${formatEuroFromCents(remaining)} à régler.`;

    const confirmationQueued = await queueGuideConfirmationText({
      tenantId: params.outbound.tenantId,
      channelId: params.outbound.channelId,
      protectionId: params.business.businessEntityId,
      occurrenceKey: params.business.businessOccurrenceId,
      text: ack,
      idempotencySuffix: `partial_ack:${commandId}`,
    });

    const processed = await deps.inbound.update({
      id: params.claimedId,
      processingStatus: "processed",
      actionKey: "payment_received_partial",
      businessCommandId: commandId,
      processedAt: at,
    });

    return {
      inboundMessageId: processed.id,
      processingStatus: "processed",
      actionKey: "payment_received_partial",
      businessCommandId: commandId,
      domainEvent: result.event,
      confirmationQueued,
    };
  }

  async function applyDirectAction(params: {
    claimedId: string;
    outbound: NonNullable<
      Awaited<ReturnType<CommunicationMessageRepository["findByProviderMessageId"]>>
    >;
    business: NonNullable<ReturnType<typeof extractOutboundBusinessReference>>;
    guideId: string;
    actionKey: Exclude<CommunicationActionKey, "payment_received_partial">;
  }): Promise<InboundProcessResult> {
    const at = now().toISOString();
    const commandId = buildBusinessCommandIdempotencyKey({
      tenantId: params.outbound.tenantId,
      outboundMessageId: params.outbound.id,
      actionKey: params.actionKey,
      interactionSequence: "1",
    });

    const confirmation = await deps.confirmations.getOrCreate({
      tenantId: params.outbound.tenantId,
      protectionId: params.business.businessEntityId,
      occurrenceId: params.business.businessOccurrenceId,
      amountDueCents: params.business.amountDueCents,
      sourceOutboundMessageId: params.outbound.id,
      now: at,
    });

    const command =
      params.actionKey === "payment_received_yes"
        ? ({
            type: "ConfirmPaymentReceived" as const,
            tenantId: params.outbound.tenantId,
            protectionId: params.business.businessEntityId,
            occurrenceId: params.business.businessOccurrenceId,
            confirmedByGuideId: params.guideId,
            sourceOutboundMessageId: params.outbound.id,
            sourceInboundMessageId: params.claimedId,
            confirmedAt: at,
            idempotencyKey: commandId,
          })
        : params.actionKey === "payment_received_no"
          ? ({
              type: "ConfirmPaymentNotReceived" as const,
              tenantId: params.outbound.tenantId,
              protectionId: params.business.businessEntityId,
              occurrenceId: params.business.businessOccurrenceId,
              confirmedByGuideId: params.guideId,
              sourceOutboundMessageId: params.outbound.id,
              sourceInboundMessageId: params.claimedId,
              confirmedAt: at,
              idempotencyKey: commandId,
            })
          : ({
              type: "MarkPaymentVerificationInProgress" as const,
              tenantId: params.outbound.tenantId,
              protectionId: params.business.businessEntityId,
              occurrenceId: params.business.businessOccurrenceId,
              confirmedByGuideId: params.guideId,
              sourceOutboundMessageId: params.outbound.id,
              sourceInboundMessageId: params.claimedId,
              initiatedAt: at,
              idempotencyKey: commandId,
            });

    const result = applyGuidePaymentCommand(confirmation, command);
    await deps.confirmations.save(result.record);

    if (result.outcome === "rejected") {
      const rejected = await deps.inbound.update({
        id: params.claimedId,
        processingStatus: "rejected",
        actionKey: params.actionKey,
        businessCommandId: commandId,
        failureCode:
          result.event.type === "GuidePaymentCommandRejected"
            ? result.event.reason
            : "rejected",
        failureMessage: "domain_rejected",
        failedAt: at,
      });
      await queueGuideConfirmationText({
        tenantId: params.outbound.tenantId,
        channelId: params.outbound.channelId,
        protectionId: params.business.businessEntityId,
        occurrenceKey: params.business.businessOccurrenceId,
        text: "Cette action n’est plus possible : l’état du règlement a déjà changé.",
        idempotencySuffix: `conflict:${commandId}`,
      });
      return {
        inboundMessageId: rejected.id,
        processingStatus: "rejected",
        actionKey: params.actionKey,
        businessCommandId: commandId,
        domainEvent: result.event,
        confirmationQueued: true,
        detail: "domain_rejected",
      };
    }

    const ackText =
      params.actionKey === "payment_received_yes"
        ? `C’est noté. Le règlement de ${params.business.amountLabel} de ${params.business.clientDisplayName} est marqué comme reçu.`
        : params.actionKey === "payment_received_no"
          ? "C’est noté. Le règlement est toujours indiqué comme non reçu."
          : "D’accord. Je garde le règlement en attente de ta vérification.";

    const confirmationQueued = await queueGuideConfirmationText({
      tenantId: params.outbound.tenantId,
      channelId: params.outbound.channelId,
      protectionId: params.business.businessEntityId,
      occurrenceKey: params.business.businessOccurrenceId,
      text: ackText,
      idempotencySuffix: `ack:${commandId}`,
    });

    const processed = await deps.inbound.update({
      id: params.claimedId,
      processingStatus: "processed",
      actionKey: params.actionKey,
      businessCommandId: commandId,
      processedAt: at,
    });

    return {
      inboundMessageId: processed.id,
      processingStatus: "processed",
      actionKey: params.actionKey,
      businessCommandId: commandId,
      domainEvent: result.event,
      confirmationQueued,
      detail: result.outcome,
    };
  }
}

/** Réexport utilitaire mapping Meta (tests). */
export { mapProviderActionIdToKey };
