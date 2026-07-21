import type { CookieOptionsWithName } from "@supabase/ssr";

export const AUTH_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
} as const;

const AUTH_HEADER_NAMES = Object.keys(AUTH_NO_STORE_HEADERS);

export function getSupabaseAuthCookieOptions(
  vercelEnvironment: string | undefined = process.env.VERCEL_ENV,
): CookieOptionsWithName {
  return {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure:
      vercelEnvironment === "preview" || vercelEnvironment === "production",
  };
}

export function applyAuthNoStoreHeaders(headers: Headers): void {
  for (const [name, value] of Object.entries(AUTH_NO_STORE_HEADERS)) {
    headers.set(name, value);
  }
}

export function copySupabaseAuthHeaders(
  source: Headers | Readonly<Record<string, string>>,
  target: Headers,
): void {
  for (const name of AUTH_HEADER_NAMES) {
    const value =
      source instanceof Headers
        ? source.get(name)
        : source[name] ?? source[name.toLowerCase()];
    if (value) target.set(name, value);
  }
}
