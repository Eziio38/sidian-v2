"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  resetPasswordAction,
  type AuthActionState,
} from "@/app/actions/auth";
import { AuthBanner } from "@/components/auth/auth-banner";
import { AuthField } from "@/components/auth/auth-field";
import { AuthSubmitButton } from "@/components/auth/auth-submit-button";

const initialState: AuthActionState = { ok: true };

export function ResetPasswordForm() {
  const [state, formAction] = useActionState(resetPasswordAction, initialState);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.message ? <AuthBanner message={state.message} tone="error" /> : null}

      <AuthField
        id="password"
        name="password"
        type="password"
        autoComplete="new-password"
        label="Nouveau mot de passe"
        hint="Au moins 8 caractères, avec une lettre et un chiffre."
        error={state.fieldErrors?.password?.[0]}
        required
      />

      <AuthField
        id="passwordConfirm"
        name="passwordConfirm"
        type="password"
        autoComplete="new-password"
        label="Confirmer le mot de passe"
        error={state.fieldErrors?.passwordConfirm?.[0]}
        required
      />

      <AuthSubmitButton pendingLabel="Mise à jour…">
        Mettre à jour le mot de passe
      </AuthSubmitButton>

      <p className="text-center text-sm text-gris-500">
        <Link
          href="/connexion"
          className="font-medium text-sidian-blue hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue"
        >
          Retour à la connexion
        </Link>
      </p>
    </form>
  );
}
