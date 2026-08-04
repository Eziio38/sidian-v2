import { createHash } from "node:crypto";

/**
 * Référence opaque d'expéditeur WhatsApp.
 * Jamais un E.164 / wa_id brut — hash HMAC-like stable (SHA-256 salted).
 */
export function opaqueWhatsAppSenderReference(from: string): string {
  const normalized = from.trim();
  if (!normalized) {
    throw new Error("whatsapp_sender_empty");
  }
  const digest = createHash("sha256")
    .update(`sidian:wa:sender:${normalized}`, "utf8")
    .digest("hex");
  return `wa_ref:${digest.slice(0, 40)}`;
}
