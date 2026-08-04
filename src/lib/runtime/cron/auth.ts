/**
 * Auth cron — Bearer CRON_SECRET uniquement (jamais en query string).
 */

import "server-only";

import { timingSafeEqual } from "node:crypto";

const MIN_CRON_SECRET_LENGTH = 16;
const FORBIDDEN_QUERY_KEYS = [
  "secret",
  "cron_secret",
  "token",
  "authorization",
  "api_key",
  "apikey",
] as const;

export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: "unauthorized" | "cron_not_configured" };

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Lit CRON_SECRET. Fail-closed si absent / trop court.
 * Ne jamais logger la valeur.
 */
export function getCronSecret(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string | null {
  const raw = env.CRON_SECRET?.trim() ?? "";
  if (raw.length < MIN_CRON_SECRET_LENGTH) {
    return null;
  }
  return raw;
}

/**
 * Vérifie Authorization: Bearer <CRON_SECRET>.
 * Refuse tout secret passé en query string.
 */
export function assertCronAuthorized(request: Request): CronAuthResult {
  const url = new URL(request.url);
  for (const key of FORBIDDEN_QUERY_KEYS) {
    if (url.searchParams.has(key)) {
      return { ok: false, status: 401, error: "unauthorized" };
    }
  }

  const secret = getCronSecret();
  if (!secret) {
    return { ok: false, status: 503, error: "cron_not_configured" };
  }

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "unauthorized" };
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token || !timingSafeEqualStrings(token, secret)) {
    return { ok: false, status: 401, error: "unauthorized" };
  }

  return { ok: true };
}
