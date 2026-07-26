/**
 * G1-Q — domaine confirmation de règlement Guide (source d'autorité).
 *
 * Décision produit prudente :
 * - on ne réutilise PAS `detecte_hors_sidian` (réservé / hors MVP auto-détection) ;
 * - on persiste une décision Guide explicite (`guide_payment_confirmation_state`) ;
 * - aucune écriture `paiement` Stripe / solde créance via cet enum interdit ;
 * - « Oui » / partiel met à jour cet état + neutralise un éventuel prélèvement
 *   automatique *planifié* au niveau de cet état (pas d'annulation d'un
 *   prélèvement Stripe déjà lancé — hors scope / décision produit ouverte).
 * - « Je vérifie » n'annule PAS de prélèvement programmé et ne suspend PAS
 *   les échéances (comportement le plus prudent — décision produit ouverte).
 */

export const GUIDE_PAYMENT_CONFIRMATION_STATES = [
  "awaiting_guide_response",
  "confirmed_received",
  "confirmed_not_received",
  "verification_in_progress",
  "partially_received",
] as const;

export type GuidePaymentConfirmationState =
  (typeof GUIDE_PAYMENT_CONFIRMATION_STATES)[number];

export type GuidePaymentConfirmationRecord = {
  id: string;
  tenantId: string;
  protectionId: string;
  occurrenceId: string;
  state: GuidePaymentConfirmationState;
  amountDueCents: number;
  amountReceivedCents: number;
  currency: "EUR";
  confirmedByGuideId: string | null;
  sourceOutboundMessageId: string | null;
  lastInboundMessageId: string | null;
  lastBusinessCommandId: string | null;
  confirmedAt: string | null;
  verificationInitiatedAt: string | null;
  /** Neutralise un prélèvement auto *futur* associé à cette occurrence. */
  autoDebitNeutralized: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ConfirmPaymentReceivedCommand = {
  type: "ConfirmPaymentReceived";
  tenantId: string;
  protectionId: string;
  occurrenceId: string;
  confirmedByGuideId: string;
  sourceOutboundMessageId: string;
  sourceInboundMessageId: string;
  confirmedAt: string;
  idempotencyKey: string;
};

export type ConfirmPaymentNotReceivedCommand = {
  type: "ConfirmPaymentNotReceived";
  tenantId: string;
  protectionId: string;
  occurrenceId: string;
  confirmedByGuideId: string;
  sourceOutboundMessageId: string;
  sourceInboundMessageId: string;
  confirmedAt: string;
  idempotencyKey: string;
};

export type MarkPaymentVerificationInProgressCommand = {
  type: "MarkPaymentVerificationInProgress";
  tenantId: string;
  protectionId: string;
  occurrenceId: string;
  confirmedByGuideId: string;
  sourceOutboundMessageId: string;
  sourceInboundMessageId: string;
  initiatedAt: string;
  idempotencyKey: string;
};

export type ApplyPartialPaymentReceivedCommand = {
  type: "ApplyPartialPaymentReceived";
  tenantId: string;
  protectionId: string;
  occurrenceId: string;
  confirmedByGuideId: string;
  sourceOutboundMessageId: string;
  sourceInboundMessageId: string;
  amountReceivedCents: number;
  confirmedAt: string;
  idempotencyKey: string;
};

export type GuidePaymentDomainCommand =
  | ConfirmPaymentReceivedCommand
  | ConfirmPaymentNotReceivedCommand
  | MarkPaymentVerificationInProgressCommand
  | ApplyPartialPaymentReceivedCommand;

export type GuidePaymentDomainEvent =
  | {
      type: "PaymentConfirmedReceived";
      at: string;
      commandId: string;
      remainingCents: 0;
    }
  | {
      type: "PaymentConfirmedNotReceived";
      at: string;
      commandId: string;
    }
  | {
      type: "PaymentVerificationInProgress";
      at: string;
      commandId: string;
      /** Explicit: does NOT suspend auto-debit schedules. */
      suspendsAutomation: false;
    }
  | {
      type: "PartialPaymentApplied";
      at: string;
      commandId: string;
      amountReceivedCents: number;
      remainingCents: number;
    }
  | {
      type: "GuidePaymentCommandIdempotentReplay";
      at: string;
      commandId: string;
      priorState: GuidePaymentConfirmationState;
    }
  | {
      type: "GuidePaymentCommandRejected";
      at: string;
      commandId: string;
      reason:
        | "incompatible_state"
        | "amount_invalid"
        | "amount_exceeds_remaining"
        | "already_settled";
    };

export type ApplyCommandResult =
  | {
      outcome: "applied" | "idempotent";
      record: GuidePaymentConfirmationRecord;
      event: GuidePaymentDomainEvent;
    }
  | {
      outcome: "rejected";
      record: GuidePaymentConfirmationRecord;
      event: GuidePaymentDomainEvent;
    };
