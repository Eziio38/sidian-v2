"use client";

import { useActionState, useId } from "react";

import type { ProfileActionResult } from "@/app/actions/profile";
import { AuthField } from "@/components/auth/auth-field";
import { AuthSubmitButton } from "@/components/auth/auth-submit-button";

type ProfileFormProps = {
  action: (
    previous: ProfileActionResult | undefined,
    formData: FormData,
  ) => Promise<ProfileActionResult>;
  initial: {
    nom: string;
    profilAgent: "controle" | "delegation";
  };
  submitLabel?: string;
};

const AGENT_PROFILES = [
  {
    value: "controle",
    title: "Je garde le contrôle",
    description:
      "Sidian prépare et suggère. Les décisions encadrées restent à valider.",
  },
  {
    value: "delegation",
    title: "Je délègue au maximum",
    description:
      "Sidian gère les communications permises par vos règles et vous sollicite dès qu’une décision engageante est nécessaire.",
  },
] as const;

export function ProfileForm({
  action,
  initial,
  submitLabel = "Enregistrer le profil",
}: ProfileFormProps) {
  const [state, formAction] = useActionState(action, undefined);
  const id = useId();
  const agentError =
    state?.ok === false ? state.fieldErrors?.profilAgent?.[0] : undefined;

  return (
    <form action={formAction} className="space-y-6">
      <AuthField
        id={`${id}-nom`}
        name="nom"
        label="Nom de votre activité"
        hint="Ce nom sera présenté à vos clients sur le parcours de paiement."
        defaultValue={initial.nom}
        autoComplete="organization"
        maxLength={200}
        error={state?.ok === false ? state.fieldErrors?.nom?.[0] : undefined}
        required
      />

      <fieldset
        className="space-y-3"
        aria-describedby={agentError ? `${id}-profil-error` : undefined}
      >
        <legend className="text-sm font-medium text-nuit">
          Niveau d’accompagnement de l’agent
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {AGENT_PROFILES.map((profile) => (
            <label
              key={profile.value}
              className="flex cursor-pointer gap-3 rounded-xl border border-gris-200 bg-white p-4 transition-colors hover:border-sidian-blue has-[:checked]:border-sidian-blue has-[:checked]:bg-blue-50"
            >
              <input
                type="radio"
                name="profilAgent"
                value={profile.value}
                defaultChecked={initial.profilAgent === profile.value}
                className="mt-1 h-4 w-4 shrink-0 accent-sidian-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue"
              />
              <span>
                <span className="block text-sm font-semibold text-nuit">
                  {profile.title}
                </span>
                <span className="mt-1 block text-sm leading-relaxed text-gris-500">
                  {profile.description}
                </span>
              </span>
            </label>
          ))}
        </div>
        {agentError ? (
          <p id={`${id}-profil-error`} role="alert" className="text-sm text-red-600">
            {agentError}
          </p>
        ) : null}
      </fieldset>

      {state?.ok === false ? (
        <p role="alert" className="text-sm text-red-600">
          {state.message}
        </p>
      ) : null}
      {state?.ok === true ? (
        <p role="status" className="text-sm text-emerald-700">
          Profil enregistré.
        </p>
      ) : null}

      <div className="max-w-xs">
        <AuthSubmitButton pendingLabel="Enregistrement…">
          {submitLabel}
        </AuthSubmitButton>
      </div>
    </form>
  );
}
