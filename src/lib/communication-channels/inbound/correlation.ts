import type { OutboundBusinessReference } from "./types";

/**
 * Extrait la référence métier immuable depuis payload_snapshot outbound.
 * Jamais depuis le webhook libre.
 */
export function extractOutboundBusinessReference(
  payloadSnapshot: Record<string, unknown>,
): OutboundBusinessReference | null {
  const business = payloadSnapshot.business as
    | Record<string, unknown>
    | undefined;
  if (!business) return null;

  const businessEntityType = business.businessEntityType;
  const businessEntityId = business.businessEntityId;
  const businessEventType = business.businessEventType;
  const businessOccurrenceId = business.businessOccurrenceId;
  const correlationKey = business.correlationKey;
  const amountDueCents = business.amountDueCents;
  const currency = business.currency;
  const clientDisplayName = business.clientDisplayName;
  const amountLabel = business.amountLabel;

  if (
    businessEntityType !== "protection" ||
    typeof businessEntityId !== "string" ||
    businessEventType !== "guide_payment_confirmation" ||
    typeof businessOccurrenceId !== "string" ||
    typeof correlationKey !== "string" ||
    typeof amountDueCents !== "number" ||
    !Number.isInteger(amountDueCents) ||
    amountDueCents <= 0 ||
    currency !== "EUR" ||
    typeof clientDisplayName !== "string" ||
    typeof amountLabel !== "string"
  ) {
    return null;
  }

  return {
    businessEntityType,
    businessEntityId,
    businessEventType,
    businessOccurrenceId,
    correlationKey,
    amountDueCents,
    currency,
    clientDisplayName,
    amountLabel,
  };
}

export function buildOutboundBusinessReference(params: {
  protectionId: string;
  occurrenceId: string;
  amountDueCents: number;
  clientDisplayName: string;
  amountLabel: string;
}): OutboundBusinessReference {
  const correlationKey = [
    "protection",
    params.protectionId,
    "guide_payment_confirmation",
    params.occurrenceId,
  ].join(":");

  return {
    businessEntityType: "protection",
    businessEntityId: params.protectionId,
    businessEventType: "guide_payment_confirmation",
    businessOccurrenceId: params.occurrenceId,
    correlationKey,
    amountDueCents: params.amountDueCents,
    currency: "EUR",
    clientDisplayName: params.clientDisplayName,
    amountLabel: params.amountLabel,
  };
}
