import { createHash } from "node:crypto";

import type { EmailTemplateKey } from "./types";

/**
 * Clé d'idempotence stable pour une intention d'envoi email.
 * Ne contient jamais d'adresse en clair (hash destinataire uniquement).
 */
export function buildEmailIdempotencyKey(parts: {
  tenantId: string;
  templateKey: EmailTemplateKey;
  entityId: string;
  occurrenceKey: string;
  recipientEmailHash: string;
}): string {
  const material = [
    parts.tenantId,
    parts.templateKey,
    parts.entityId,
    parts.occurrenceKey,
    parts.recipientEmailHash,
  ].join("|");

  return createHash("sha256").update(material).digest("hex").slice(0, 64);
}
