/**
 * Redaction données sensibles avant logs / observabilité / traces.
 */

const SENSITIVE_KEY_PATTERN =
  /^(.*[_-]?)?(password|passwd|secret|token|authorization|api[_-]?key|private[_-]?key|pan|iban|card[_-]?number|cvv|cvc|jwt|bearer|access[_-]?token|refresh[_-]?token|stack|stacktrace|stack_trace)$/i;

const EMAIL_RE =
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const E164_RE = /\+[1-9]\d{7,14}\b/g;
const IBAN_RE = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g;
const CARD_RE = /\b(?:\d[ -]*?){13,19}\b/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

export const REDACTED = "[redacted]";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

/** Redige PII / secrets dans une chaîne libre. */
export function redactText(text: string): string {
  return text
    .replace(JWT_RE, REDACTED)
    .replace(BEARER_RE, `Bearer ${REDACTED}`)
    .replace(EMAIL_RE, REDACTED)
    .replace(E164_RE, REDACTED)
    .replace(IBAN_RE, REDACTED)
    .replace(CARD_RE, REDACTED);
}

/**
 * Redige récursivement un payload JSON-like.
 * Clés sensibles → marqueur ; valeurs string → redactText.
 */
export function redactSensitive(
  value: unknown,
  depth = 0,
): unknown {
  if (depth > 8) return null;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, depth + 1));
  }
  if (!isPlainObject(value)) return null;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = redactSensitive(child, depth + 1);
  }
  return out;
}

/**
 * Prépare un contenu utilisateur avant envoi au modèle :
 * retire JWT / Bearer évidents ; conserve e-mails métier nécessaires à l’extraction.
 */
export function sanitizeUserContentForModel(text: string): string {
  return text
    .replace(JWT_RE, REDACTED)
    .replace(BEARER_RE, `Bearer ${REDACTED}`)
    .replace(IBAN_RE, REDACTED)
    .replace(CARD_RE, REDACTED)
    .slice(0, 8_000);
}
