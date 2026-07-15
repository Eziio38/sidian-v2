"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  forgotPasswordAction,
  type AuthActionState,
} from "@/app/actions/auth";
import { AuthBanner } from "@/components/auth/auth-banner";
import { AuthField } from "@/components/auth/auth-field";
import { AuthSubmitButton } from "@/components/auth/auth-submit-button";

const initialState: AuthActionState = { ok: true };

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(forgotPasswordAction, initialState);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.message ? (
        <AuthBanner
          message={state.message}
          tone={state.ok ? "success" : "error"}
        />
      ) : null}

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

      <AuthSubmitButton pendingLabel="Envoi en cours…">
        Envoyer le lien
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
