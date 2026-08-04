import { createHash } from "node:crypto";

import type { CommunicationActionKey } from "./actions";

/**
 * Idempotence métier (niveau 2).
 * tenant + outbound + action (+ sequence pour textes partiels).
 */
export function buildBusinessCommandIdempotencyKey(params: {
  tenantId: string;
  outboundMessageId: string;
  actionKey: CommunicationActionKey | "partial_amount";
  interactionSequence: string;
}): string {
  const material = [
    params.tenantId,
    params.outboundMessageId,
    params.actionKey,
    params.interactionSequence,
  ].join("|");
  return createHash("sha256").update(material).digest("hex").slice(0, 64);
}
