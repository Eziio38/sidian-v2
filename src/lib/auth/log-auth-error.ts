import "server-only";

import type { AuthError } from "@supabase/supabase-js";

type AuthErrorLike = Pick<AuthError, "code" | "status" | "message" | "name">;

export function logSupabaseAuthError(
  operation: string,
  error: AuthErrorLike,
  context?: Record<string, string | number | boolean | null | undefined>,
): void {
  console.error(
    `[auth:${operation}]`,
    JSON.stringify({
      code: error.code ?? error.name ?? "unknown",
      status: error.status ?? null,
      message: error.message,
      ...context,
    }),
  );
}

export function logSignUpInputPresence(formData: FormData): void {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  console.error(
    "[auth:signUp:input]",
    JSON.stringify({
      hasDisplayName: Boolean(formData.get("displayName")),
      hasAgencyName: Boolean(formData.get("agencyName")),
      hasEmail: Boolean(formData.get("email")),
      hasPassword: Boolean(formData.get("password")),
      hasPasswordConfirm: Boolean(formData.get("passwordConfirm")),
      acceptCgu: formData.get("acceptCgu") === "on",
      acceptPrivacy: formData.get("acceptPrivacy") === "on",
    }),
  );
}
