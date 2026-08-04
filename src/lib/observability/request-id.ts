export const REQUEST_ID_HEADER = "x-sidian-request-id";
const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createRequestId(): string {
  return crypto.randomUUID();
}

export function requestIdFromHeaders(headers: Headers): string | null {
  const value = headers.get(REQUEST_ID_HEADER)?.trim();
  return value && REQUEST_ID_PATTERN.test(value) ? value : null;
}
