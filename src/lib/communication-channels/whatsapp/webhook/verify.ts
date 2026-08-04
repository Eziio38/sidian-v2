import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Vérification challenge GET Meta + signature X-Hub-Signature-256.
 */

export function verifyWhatsAppWebhookChallenge(params: {
  mode: string | null;
  verifyToken: string | null;
  challenge: string | null;
  expectedToken: string;
}): { ok: true; challenge: string } | { ok: false } {
  if (
    params.mode === "subscribe" &&
    params.verifyToken &&
    params.challenge &&
    timingSafeEqualStrings(params.verifyToken, params.expectedToken)
  ) {
    return { ok: true, challenge: params.challenge };
  }
  return { ok: false };
}

export function verifyWhatsAppSignature(params: {
  rawBody: Buffer;
  signatureHeader: string | null;
  appSecret: string;
}): boolean {
  if (!params.signatureHeader?.startsWith("sha256=")) {
    return false;
  }
  const provided = params.signatureHeader.slice("sha256=".length);
  const expected = createHmac("sha256", params.appSecret)
    .update(params.rawBody)
    .digest("hex");
  return timingSafeEqualStrings(provided, expected);
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
