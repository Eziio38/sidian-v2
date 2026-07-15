"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  signUpAction,
  type AuthActionState,
} from "@/app/actions/auth";
import { AuthBanner } from "@/components/auth/auth-banner";
import { AuthCheckboxField, AuthField } from "@/components/auth/auth-field";
import { AuthSubmitButton } from "@/components/auth/auth-submit-button";

const initialState: AuthActionState = { ok: true };

export function SignUpForm() {
  const [state, formAction] = useActionState(signUpAction, initialState);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.message ? <AuthBanner message={state.message} tone="error" /> : null}

      <AuthField
        id="displayName"
        name="displayName"
        type="text"
        autoComplete="name"
        label="Comment vous appeler"
        placeholder="Prénom ou nom affiché"
        error={state.fieldErrors?.displayName?.[0]}
        required
      />

      <AuthField
        id="agencyName"
        name="agencyName"
        type="text"
        autoComplete="organization"
        label="Nom de l'agence ou activité"
        placeholder="Ex. Studio Horizon"
        error={state.fieldErrors?.agencyName?.[0]}
        required
      />

      <AuthField
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        label="Email professionnel"
        placeholder="vous@agence.fr"
        error={state.fieldErrors?.email?.[0]}
        required
      />

      <AuthField
        id="password"
        name="password"
        type="password"
        autoComplete="new-password"
        label="Mot de passe"
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

      <AuthCheckboxField
        id="acceptCgu"
        name="acceptCgu"
        label={
          <>
            J&apos;accepte les{" "}
            <span className="font-medium text-nuit">conditions générales d&apos;utilisation</span>
          </>
        }
        error={state.fieldErrors?.acceptCgu?.[0]}
      />

      <AuthCheckboxField
        id="acceptPrivacy"
        name="acceptPrivacy"
        label={
          <>
            J&apos;accepte la{" "}
            <span className="font-medium text-nuit">politique de confidentialité</span>
          </>
        }
        error={state.fieldErrors?.acceptPrivacy?.[0]}
      />

      <AuthSubmitButton pendingLabel="Création du compte…">
        Créer mon compte
      </AuthSubmitButton>

      <p className="text-center text-sm text-gris-500">
        Déjà inscrit ?{" "}
        <Link
          href="/connexion"
          className="font-medium text-sidian-blue hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue"
        >
          Se connecter
        </Link>
      </p>
    </form>
  );
}
