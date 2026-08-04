"use client";

import { useActionState, useId } from "react";

import type { AccountClosureActionResult } from "@/app/actions/account";
import { Button, Input } from "@/design-system";

import formStyles from "../form-layout.module.css";
import styles from "./settings.module.css";

type AccountClosureFormProps = {
  action: (
    previous: AccountClosureActionResult | undefined,
    formData: FormData,
  ) => Promise<AccountClosureActionResult>;
  /** Adresse à ressaisir — vient de la session, jamais d'un champ du formulaire. */
  accountEmail: string;
};

/**
 * Clôture du compte.
 *
 * Deux garde-fous délibérés :
 *
 * 1. La ressaisie de l'adresse du compte. L'opération est irréversible et
 *    aucune réouverture n'est implémentée : un simple clic serait trop peu.
 * 2. Le compte rendu affiché après coup vient de `summary`, produit par le
 *    serveur. Il dit explicitement ce qui RESTE en base. On n'écrit jamais
 *    « compte supprimé » : les pièces comptables sont conservées au titre de
 *    l'obligation légale de conservation, et un échec partiel (fichiers non
 *    effacés, accès non révoqué) y apparaît en toutes lettres.
 */
export function AccountClosureForm({
  action,
  accountEmail,
}: AccountClosureFormProps) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const id = useId();

  if (state?.ok === true) {
    return (
      <ul role="status" className={styles.summaryList}>
        {state.summary.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    );
  }

  return (
    <form action={formAction} className={formStyles.form}>
      <p className={styles.note}>
        La clôture anonymise ton identité, efface tes conversations et supprime
        tes documents.{" "}
        <span className={styles.noteStrong}>
          Tes clients, paiements à recevoir et paiements sont conservés
        </span>{" "}
        : la loi impose de garder les pièces comptables. L’opération est
        irréversible.
      </p>

      <Input
        id={`${id}-confirmation`}
        name="confirmation"
        type="email"
        label="Confirme en saisissant l’adresse de ton compte"
        hint={accountEmail}
        autoComplete="off"
        spellCheck={false}
        required
        error={state?.ok === false ? state.message : undefined}
      />

      <div className={formStyles.submit}>
        <Button
          type="submit"
          variant="destructive"
          loading={pending}
          loadingLabel="Clôture en cours…"
        >
          Clôturer définitivement mon compte
        </Button>
      </div>
    </form>
  );
}
