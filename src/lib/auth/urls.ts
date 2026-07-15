import { getPublicEnv } from "@/config/env-public";

export function getAppUrl(): string {
  return getPublicEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
}

export function buildAuthCallbackUrl(next?: string): string {
  const base = `${getAppUrl()}/auth/callback`;

  if (!next) {
    return base;
  }

  return `${base}?next=${encodeURIComponent(next)}`;
}
