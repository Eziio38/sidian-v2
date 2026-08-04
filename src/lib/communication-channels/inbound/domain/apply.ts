import type {
  ApplyCommandResult,
  ApplyPartialPaymentReceivedCommand,
  ConfirmPaymentNotReceivedCommand,
  ConfirmPaymentReceivedCommand,
  GuidePaymentConfirmationRecord,
  GuidePaymentConfirmationState,
  GuidePaymentDomainCommand,
  MarkPaymentVerificationInProgressCommand,
} from "./types";

/**
 * Matrice de transitions (domaine = source d'autorité).
 * Jamais d'écrasement silencieux d'une décision financière.
 */
const ALLOWED: Record<
  GuidePaymentConfirmationState,
  ReadonlySet<GuidePaymentConfirmationState>
> = {
  awaiting_guide_response: new Set([
    "confirmed_received",
    "confirmed_not_received",
    "verification_in_progress",
    "partially_received",
  ]),
  verification_in_progress: new Set([
    "confirmed_received",
    "confirmed_not_received",
    "partially_received",
    "verification_in_progress",
  ]),
  confirmed_not_received: new Set([
    "confirmed_received",
    "verification_in_progress",
    "partially_received",
    "confirmed_not_received",
  ]),
  partially_received: new Set([
    "confirmed_received",
    "partially_received",
    "verification_in_progress",
  ]),
  confirmed_received: new Set(["confirmed_received"]),
};

export function canTransitionGuidePaymentState(
  from: GuidePaymentConfirmationState,
  to: GuidePaymentConfirmationState,
): boolean {
  return ALLOWED[from]?.has(to) ?? false;
}

function remainingCents(record: GuidePaymentConfirmationRecord): number {
  return Math.max(0, record.amountDueCents - record.amountReceivedCents);
}

function clone(
  record: GuidePaymentConfirmationRecord,
): GuidePaymentConfirmationRecord {
  return { ...record };
}

function applyYes(
  record: GuidePaymentConfirmationRecord,
  command: ConfirmPaymentReceivedCommand,
): ApplyCommandResult {
  if (
    record.state === "confirmed_received" &&
    record.lastBusinessCommandId === command.idempotencyKey
  ) {
    return {
      outcome: "idempotent",
      record: clone(record),
      event: {
        type: "GuidePaymentCommandIdempotentReplay",
        at: command.confirmedAt,
        commandId: command.idempotencyKey,
        priorState: record.state,
      },
    };
  }

  if (record.state === "confirmed_received") {
    return {
      outcome: "idempotent",
      record: clone(record),
      event: {
        type: "GuidePaymentCommandIdempotentReplay",
        at: command.confirmedAt,
        commandId: command.idempotencyKey,
        priorState: record.state,
      },
    };
  }

  if (!canTransitionGuidePaymentState(record.state, "confirmed_received")) {
    return {
      outcome: "rejected",
      record: clone(record),
      event: {
        type: "GuidePaymentCommandRejected",
        at: command.confirmedAt,
        commandId: command.idempotencyKey,
        reason: "incompatible_state",
      },
    };
  }

  const next: GuidePaymentConfirmationRecord = {
    ...record,
    state: "confirmed_received",
    amountReceivedCents: record.amountDueCents,
    confirmedByGuideId: command.confirmedByGuideId,
    sourceOutboundMessageId: command.sourceOutboundMessageId,
    lastInboundMessageId: command.sourceInboundMessageId,
    lastBusinessCommandId: command.idempotencyKey,
    confirmedAt: command.confirmedAt,
    autoDebitNeutralized: true,
    updatedAt: command.confirmedAt,
  };

  return {
    outcome: "applied",
    record: next,
    event: {
      type: "PaymentConfirmedReceived",
      at: command.confirmedAt,
      commandId: command.idempotencyKey,
      remainingCents: 0,
    },
  };
}

function applyNo(
  record: GuidePaymentConfirmationRecord,
  command: ConfirmPaymentNotReceivedCommand,
): ApplyCommandResult {
  if (
    record.state === "confirmed_not_received" &&
    (record.lastBusinessCommandId === command.idempotencyKey ||
      record.state === "confirmed_not_received")
  ) {
    if (record.lastBusinessCommandId === command.idempotencyKey) {
      return {
        outcome: "idempotent",
        record: clone(record),
        event: {
          type: "GuidePaymentCommandIdempotentReplay",
          at: command.confirmedAt,
          commandId: command.idempotencyKey,
          priorState: record.state,
        },
      };
    }
  }

  if (record.state === "confirmed_received") {
    return {
      outcome: "rejected",
      record: clone(record),
      event: {
        type: "GuidePaymentCommandRejected",
        at: command.confirmedAt,
        commandId: command.idempotencyKey,
        reason: "already_settled",
      },
    };
  }

  if (record.state === "confirmed_not_received") {
    return {
      outcome: "idempotent",
      record: clone(record),
      event: {
        type: "GuidePaymentCommandIdempotentReplay",
        at: command.confirmedAt,
        commandId: command.idempotencyKey,
        priorState: record.state,
      },
    };
  }

  if (!canTransitionGuidePaymentState(record.state, "confirmed_not_received")) {
    return {
      outcome: "rejected",
      record: clone(record),
      event: {
        type: "GuidePaymentCommandRejected",
        at: command.confirmedAt,
        commandId: command.idempotencyKey,
        reason: "incompatible_state",
      },
    };
  }

  const next: GuidePaymentConfirmationRecord = {
    ...record,
    state: "confirmed_not_received",
    confirmedByGuideId: command.confirmedByGuideId,
    sourceOutboundMessageId: command.sourceOutboundMessageId,
    lastInboundMessageId: command.sourceInboundMessageId,
    lastBusinessCommandId: command.idempotencyKey,
    confirmedAt: command.confirmedAt,
    // « Non » n'exécute PAS de prélèvement et n'annule PAS un schedule.
    autoDebitNeutralized: record.autoDebitNeutralized,
    updatedAt: command.confirmedAt,
  };

  return {
    outcome: "applied",
    record: next,
    event: {
      type: "PaymentConfirmedNotReceived",
      at: command.confirmedAt,
      commandId: command.idempotencyKey,
    },
  };
}

function applyChecking(
  record: GuidePaymentConfirmationRecord,
  command: MarkPaymentVerificationInProgressCommand,
): ApplyCommandResult {
  if (record.state === "confirmed_received") {
    return {
      outcome: "rejected",
      record: clone(record),
      event: {
        type: "GuidePaymentCommandRejected",
        at: command.initiatedAt,
        commandId: command.idempotencyKey,
        reason: "already_settled",
      },
    };
  }

  // Matrice : « Je vérifie » depuis verification_in_progress → idempotent.
  if (record.state === "verification_in_progress") {
    return {
      outcome: "idempotent",
      record: clone(record),
      event: {
        type: "GuidePaymentCommandIdempotentReplay",
        at: command.initiatedAt,
        commandId: command.idempotencyKey,
        priorState: record.state,
      },
    };
  }

  if (
    !canTransitionGuidePaymentState(record.state, "verification_in_progress")
  ) {
    return {
      outcome: "rejected",
      record: clone(record),
      event: {
        type: "GuidePaymentCommandRejected",
        at: command.initiatedAt,
        commandId: command.idempotencyKey,
        reason: "incompatible_state",
      },
    };
  }

  const next: GuidePaymentConfirmationRecord = {
    ...record,
    state: "verification_in_progress",
    confirmedByGuideId: command.confirmedByGuideId,
    sourceOutboundMessageId: command.sourceOutboundMessageId,
    lastInboundMessageId: command.sourceInboundMessageId,
    lastBusinessCommandId: command.idempotencyKey,
    verificationInitiatedAt: command.initiatedAt,
    // Prudent : ne suspend PAS l'automation / ne neutralise PAS.
    autoDebitNeutralized: record.autoDebitNeutralized,
    updatedAt: command.initiatedAt,
  };

  return {
    outcome: "applied",
    record: next,
    event: {
      type: "PaymentVerificationInProgress",
      at: command.initiatedAt,
      commandId: command.idempotencyKey,
      suspendsAutomation: false,
    },
  };
}

function applyPartial(
  record: GuidePaymentConfirmationRecord,
  command: ApplyPartialPaymentReceivedCommand,
): ApplyCommandResult {
  if (record.state === "confirmed_received") {
    return {
      outcome: "rejected",
      record: clone(record),
      event: {
        type: "GuidePaymentCommandRejected",
        at: command.confirmedAt,
        commandId: command.idempotencyKey,
        reason: "already_settled",
      },
    };
  }

  if (record.lastBusinessCommandId === command.idempotencyKey) {
    return {
      outcome: "idempotent",
      record: clone(record),
      event: {
        type: "GuidePaymentCommandIdempotentReplay",
        at: command.confirmedAt,
        commandId: command.idempotencyKey,
        priorState: record.state,
      },
    };
  }

  if (command.amountReceivedCents <= 0) {
    return {
      outcome: "rejected",
      record: clone(record),
      event: {
        type: "GuidePaymentCommandRejected",
        at: command.confirmedAt,
        commandId: command.idempotencyKey,
        reason: "amount_invalid",
      },
    };
  }

  const rem = remainingCents(record);
  if (command.amountReceivedCents > rem) {
    return {
      outcome: "rejected",
      record: clone(record),
      event: {
        type: "GuidePaymentCommandRejected",
        at: command.confirmedAt,
        commandId: command.idempotencyKey,
        reason: "amount_exceeds_remaining",
      },
    };
  }

  const targetState =
    command.amountReceivedCents === rem
      ? "confirmed_received"
      : "partially_received";

  if (!canTransitionGuidePaymentState(record.state, targetState)) {
    return {
      outcome: "rejected",
      record: clone(record),
      event: {
        type: "GuidePaymentCommandRejected",
        at: command.confirmedAt,
        commandId: command.idempotencyKey,
        reason: "incompatible_state",
      },
    };
  }

  const newReceived = record.amountReceivedCents + command.amountReceivedCents;
  const nextRemaining = record.amountDueCents - newReceived;
  const next: GuidePaymentConfirmationRecord = {
    ...record,
    state: targetState,
    amountReceivedCents: newReceived,
    confirmedByGuideId: command.confirmedByGuideId,
    sourceOutboundMessageId: command.sourceOutboundMessageId,
    lastInboundMessageId: command.sourceInboundMessageId,
    lastBusinessCommandId: command.idempotencyKey,
    confirmedAt: command.confirmedAt,
    autoDebitNeutralized:
      targetState === "confirmed_received" ? true : record.autoDebitNeutralized,
    updatedAt: command.confirmedAt,
  };

  if (targetState === "confirmed_received") {
    return {
      outcome: "applied",
      record: next,
      event: {
        type: "PaymentConfirmedReceived",
        at: command.confirmedAt,
        commandId: command.idempotencyKey,
        remainingCents: 0,
      },
    };
  }

  return {
    outcome: "applied",
    record: next,
    event: {
      type: "PartialPaymentApplied",
      at: command.confirmedAt,
      commandId: command.idempotencyKey,
      amountReceivedCents: command.amountReceivedCents,
      remainingCents: nextRemaining,
    },
  };
}

export function applyGuidePaymentCommand(
  record: GuidePaymentConfirmationRecord,
  command: GuidePaymentDomainCommand,
): ApplyCommandResult {
  switch (command.type) {
    case "ConfirmPaymentReceived":
      return applyYes(record, command);
    case "ConfirmPaymentNotReceived":
      return applyNo(record, command);
    case "MarkPaymentVerificationInProgress":
      return applyChecking(record, command);
    case "ApplyPartialPaymentReceived":
      return applyPartial(record, command);
    default: {
      const _exhaustive: never = command;
      return _exhaustive;
    }
  }
}

export function createInitialGuidePaymentConfirmation(params: {
  id: string;
  tenantId: string;
  protectionId: string;
  occurrenceId: string;
  amountDueCents: number;
  now: string;
  sourceOutboundMessageId?: string;
}): GuidePaymentConfirmationRecord {
  return {
    id: params.id,
    tenantId: params.tenantId,
    protectionId: params.protectionId,
    occurrenceId: params.occurrenceId,
    state: "awaiting_guide_response",
    amountDueCents: params.amountDueCents,
    amountReceivedCents: 0,
    currency: "EUR",
    confirmedByGuideId: null,
    sourceOutboundMessageId: params.sourceOutboundMessageId ?? null,
    lastInboundMessageId: null,
    lastBusinessCommandId: null,
    confirmedAt: null,
    verificationInitiatedAt: null,
    autoDebitNeutralized: false,
    createdAt: params.now,
    updatedAt: params.now,
  };
}
