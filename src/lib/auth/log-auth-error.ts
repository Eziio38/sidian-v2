import "server-only";

import type { AuthError } from "@supabase/supabase-js";

import { logServerEvent } from "@/lib/observability/server-logger";

type AuthErrorLike = Pick<AuthError, "code" | "status" | "message" | "name">;

export function logSupabaseAuthError(
  operation: string,
  error: AuthErrorLike,
  context?: Record<string, string | number | boolean | null | undefined>,
): void {
  logServerEvent("error", "auth.supabase_error", {
    operation,
    errorCode: error.code ?? error.name ?? "unknown",
    status: error.status ?? null,
    ...context,
  });
}

export function logSignUpInputPresence(formData: FormData): void {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  logServerEvent("info", "auth.signup_input_presence", {
    hasDisplayName: Boolean(formData.get("displayName")),
    hasAgencyName: Boolean(formData.get("agencyName")),
    hasEmail: Boolean(formData.get("email")),
    hasPassword: Boolean(formData.get("password")),
    hasPasswordConfirm: Boolean(formData.get("passwordConfirm")),
    acceptCgu: formData.get("acceptCgu") === "on",
    acceptPrivacy: formData.get("acceptPrivacy") === "on",
  });
}
