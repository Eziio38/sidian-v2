"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  signInAction,
  type AuthActionState,
} from "@/app/actions/auth";
import { AuthBanner } from "@/components/auth/auth-banner";
import { AuthField } from "@/components/auth/auth-field";
import { AuthSubmitButton } from "@/components/auth/auth-submit-button";

const initialState: AuthActionState = { ok: true };

type SignInFormProps = {
  message?: string;
  error?: string;
};

export function SignInForm({ message, error }: SignInFormProps) {
  const [state, formAction] = useActionState(signInAction, initialState);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {message ? <AuthBanner message={message} tone="success" /> : null}
      {error ? <AuthBanner message={error} tone="error" /> : null}
      {state.message ? <AuthBanner message={state.message} tone="error" /> : null}

      <AuthField
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        label="Email"
        placeholder="vous@agence.fr"
        error={state.fieldErrors?.email?.[0]}
        required
      />

      <AuthField
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        label="Mot de passe"
        error={state.fieldErrors?.password?.[0]}
        required
      />

      <div className="flex justify-end">
        <Link
          href="/mot-de-passe-oublie"
          className="text-sm font-medium text-sidian-blue hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue"
        >
          Mot de passe oublié ?
        </Link>
      </div>

      <AuthSubmitButton pendingLabel="Connexion en cours…">
        Se connecter
      </AuthSubmitButton>
    </form>
  );
}
