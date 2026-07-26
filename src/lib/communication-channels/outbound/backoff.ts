/**
 * Backoff déterministe pour retries outbox WhatsApp.
 * attemptCount = nombre de tentatives déjà consommées (après claim).
 */

export function computeRetryDelaySeconds(attemptCount: number): number {
  const attempt = Math.max(1, Math.floor(attemptCount));
  // 30, 60, 120, 240… plafonné à 15 min
  return Math.min(900, 30 * 2 ** (attempt - 1));
}

export function isPermanentErrorCode(code: string | null | undefined): boolean {
  if (!code) return false;
  const permanent = new Set([
    "validation_error",
    "configuration_error",
    "authentication_error",
    "max_attempts",
    "payload_incomplete",
    "template_unknown",
    "recipient_invalid",
  ]);
  return permanent.has(code);
}
