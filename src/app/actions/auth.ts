"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { ensurePrestataireForUser } from "@/lib/auth/ensure-prestataire";
import { AUTH_MESSAGES } from "@/lib/auth/messages";
import {
  evaluateAuthRateLimit,
  type AuthRateLimitOperation,
} from "@/lib/auth/rate-limit";
import {
  forgotPasswordSchema,
  formatZodFieldErrors,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/auth/schemas";
import { buildAuthCallbackUrl } from "@/lib/auth/urls";
import {
  logSignUpInputPresence,
  logSupabaseAuthError,
} from "@/lib/auth/log-auth-error";
import { createClient } from "@/lib/supabase/server";

export type AuthActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
};

function checkboxValue(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}

function failure(
  fieldErrors?: Record<string, string[]>,
  message?: string,
): AuthActionState {
  return {
    ok: false,
    fieldErrors,
    message,
  };
}

function success(message?: string): AuthActionState {
  return {
    ok: true,
    message,
  };
}

async function authRateLimit(
  operation: AuthRateLimitOperation,
  identity: string,
) {
  return evaluateAuthRateLimit({
    operation,
    requestHeaders: await headers(),
    identity,
  });
}

export async function signUpAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  logSignUpInputPresence(formData);

  const parsed = signUpSchema.safeParse({
    displayName: formData.get("displayName"),
    agencyName: formData.get("agencyName"),
    email: formData.get("email"),
    password: formData.get("password"),
    passwordConfirm: formData.get("passwordConfirm"),
    acceptCgu: checkboxValue(formData, "acceptCgu"),
    acceptPrivacy: checkboxValue(formData, "acceptPrivacy"),
  });

  if (!parsed.success) {
    return failure(formatZodFieldErrors(parsed.error));
  }

  const rateLimit = await authRateLimit("sign_up", parsed.data.email);
  if (rateLimit.status !== "allowed") {
    return failure(undefined, AUTH_MESSAGES.genericRateLimitError);
  }

  const supabase = await createClient();
  const emailRedirectTo = buildAuthCallbackUrl();

  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo,
      data: {
        display_name: parsed.data.displayName,
        agency_name: parsed.data.agencyName,
      },
    },
  });

  if (error) {
    logSupabaseAuthError("signUp", error, {
      redirectHost: new URL(emailRedirectTo).host,
      redirectPath: new URL(emailRedirectTo).pathname,
    });
    return failure(undefined, AUTH_MESSAGES.genericAuthError);
  }

  redirect("/inscription/verifier-email");
}

export async function signInAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return failure(formatZodFieldErrors(parsed.error));
  }

  const rateLimit = await authRateLimit("sign_in", parsed.data.email);
  if (rateLimit.status !== "allowed") {
    return failure(undefined, AUTH_MESSAGES.genericRateLimitError);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    return failure(undefined, AUTH_MESSAGES.genericSignInError);
  }

  if (!data.user.email_confirmed_at) {
    await supabase.auth.signOut();
    redirect("/inscription/verifier-email");
  }

  await ensurePrestataireForUser(supabase, data.user);
  redirect("/app");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/connexion");
}

export async function forgotPasswordAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = forgotPasswordSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return failure(formatZodFieldErrors(parsed.error));
  }

  const rateLimit = await authRateLimit("password_reset", parsed.data.email);
  if (rateLimit.status !== "allowed") {
    // Même réponse qu'une demande acceptée : ni l'existence du compte ni la
    // décision de quota ne sont révélées sur ce parcours public.
    return success(AUTH_MESSAGES.genericPasswordResetSent);
  }

  const supabase = await createClient();

  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: buildAuthCallbackUrl("/reinitialiser-mot-de-passe"),
  });

  return success(AUTH_MESSAGES.genericPasswordResetSent);
}

export async function resetPasswordAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    passwordConfirm: formData.get("passwordConfirm"),
  });

  if (!parsed.success) {
    return failure(formatZodFieldErrors(parsed.error));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/connexion?erreur=session");
  }

  const rateLimit = await authRateLimit("password_update", user.id);
  if (rateLimit.status !== "allowed") {
    return failure(undefined, AUTH_MESSAGES.genericRateLimitError);
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) {
    return failure(undefined, AUTH_MESSAGES.genericAuthError);
  }

  redirect("/connexion?message=mot-de-passe-mis-a-jour");
}
