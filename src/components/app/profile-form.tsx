"use client";

import { useActionState, useId } from "react";

import type { ProfileActionResult } from "@/app/actions/profile";
import { AuthField } from "@/components/auth/auth-field";
import { AuthSubmitButton } from "@/components/auth/auth-submit-button";

import styles from "./form-layout.module.css";
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
    <form action={formAction} className={`${styles.form} ${styles.formSpacious}`}>
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

      {/*
        `aria-invalid` n'est pas supporté par le rôle `radio` (ARIA 1.2) : il se
        porte sur le groupe. `role="radiogroup"` est explicite car un
        `fieldset` seul est exposé en `group`, qui lui non plus n'accepte pas
        `aria-invalid`.
      */}
      <fieldset
        className={styles.fieldset}
        role="radiogroup"
        aria-invalid={agentError ? true : undefined}
        aria-describedby={agentError ? `${id}-profil-error` : undefined}
      >
        <legend className={styles.legend}>
          Niveau d’accompagnement de l’agent
        </legend>
        <div className={styles.optionGrid}>
          {AGENT_PROFILES.map((profile) => (
            <label
              key={profile.value}
              className={styles.option}
            >
              <input
                type="radio"
                name="profilAgent"
                value={profile.value}
                defaultChecked={initial.profilAgent === profile.value}
                // Le message reste rattaché à chaque option : à la tabulation,
                // le lecteur d'écran ne réannonce pas le groupe.
                aria-describedby={agentError ? `${id}-profil-error` : undefined}
                className={styles.radio}
              />
              <span>
                <span className={styles.optionTitle}>
                  {profile.title}
                </span>
                <span className={styles.optionDescription}>
                  {profile.description}
                </span>
              </span>
            </label>
          ))}
        </div>
        {agentError ? (
          <p
            id={`${id}-profil-error`}
            role="alert"
            className={`${styles.formStatus} ${styles.formError}`}
          >
            {agentError}
          </p>
        ) : null}
      </fieldset>

      {state?.ok === false ? (
        <p role="alert" className={`${styles.formStatus} ${styles.formError}`}>
          {state.message}
        </p>
      ) : null}
      {state?.ok === true ? (
        <p
          role="status"
          className={`${styles.formStatus} ${styles.formSuccess}`}
        >
          Profil enregistré.
        </p>
      ) : null}

      <div className={styles.submit}>
        <AuthSubmitButton pendingLabel="Enregistrement…">
          {submitLabel}
        </AuthSubmitButton>
      </div>
    </form>
  );
}
