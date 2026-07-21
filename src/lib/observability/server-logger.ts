import "server-only";

export type ServerLogLevel = "info" | "warn" | "error";

const REDACTED = "[REDACTED]";
const MAX_DEPTH = 4;
const MAX_ITEMS = 25;
const MAX_STRING_LENGTH = 512;
const SENSITIVE_KEY_PATTERN =
  /(?:^|_)(?:authorization|cookie|password|secret|token|api_key|email|iban|card|otp|message|stack|referer|referrer|url|query)(?:_|$)|authorization_code|verification_code/i;
const SENSITIVE_VALUE_PATTERN =
  /(?:bearer\s+\S+|(?:sk|pk|rk)_(?:test|live)_\S+|whsec_\S+|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|\b[^\s@]+@[^\s@]+\.[^\s@]+\b)/i;

function normalizeKey(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
}

function sanitizeString(value: string): string {
  if (SENSITIVE_VALUE_PATTERN.test(value)) {
    return REDACTED;
  }

  if (value.length > MAX_STRING_LENGTH) {
    return `${value.slice(0, MAX_STRING_LENGTH)}[TRUNCATED]`;
  }

  return value;
}

function sanitizeValue(
  value: unknown,
  key: string,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (SENSITIVE_KEY_PATTERN.test(normalizeKey(key))) {
    return REDACTED;
  }

  if (value === null || value === undefined) {
    return value ?? null;
  }

  if (typeof value === "string") {
    return sanitizeString(value);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (value instanceof Error) {
    return { name: sanitizeString(value.name || "Error") };
  }

  if (typeof value !== "object") {
    return "[UNSUPPORTED]";
  }

  if (depth >= MAX_DEPTH || seen.has(value)) {
    return "[OMITTED]";
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ITEMS)
      .map((item) => sanitizeValue(item, "item", depth + 1, seen));
  }

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, MAX_ITEMS)
      .map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeValue(entryValue, entryKey, depth + 1, seen),
      ]),
  );
}

export function redactLogContext(
  context: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return sanitizeValue(context, "context", 0, new WeakSet()) as Record<
    string,
    unknown
  >;
}

export function logServerEvent(
  level: ServerLogLevel,
  event: string,
  context: Readonly<Record<string, unknown>> = {},
): void {
  const record = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event: /^[a-z0-9._-]{1,80}$/i.test(event) ? event : "invalid_event",
    context: redactLogContext(context),
  });

  if (level === "error") {
    console.error(record);
    return;
  }

  if (level === "warn") {
    console.warn(record);
    return;
  }

  console.info(record);
}
