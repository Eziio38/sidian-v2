import { createHash } from "node:crypto";

/**
 * Clé d'idempotence stable pour une intention métier d'envoi.
 * Ne contient jamais de numéro de téléphone.
 */
export function buildOutboundIdempotencyKey(parts: {
  tenantId: string;
  eventType: string;
  entityId: string;
  occurrenceKey: string;
  recipientReference: string;
}): string {
  const material = [
    parts.tenantId,
    parts.eventType,
    parts.entityId,
    parts.occurrenceKey,
    parts.recipientReference,
  ].join("|");

  return createHash("sha256").update(material).digest("hex").slice(0, 64);
}

export function guideRecipientReference(prestataireId: string): string {
  return `guide:${prestataireId}`;
}
