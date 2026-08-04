"use client";

import { useState, useTransition } from "react";

import { exportAccountDataAction } from "@/app/actions/account";
import { Button } from "@/design-system";

import formStyles from "../form-layout.module.css";
import styles from "./settings.module.css";

/**
 * Export RGPD des données du compte.
 *
 * L'action serveur ne reçoit aucun identifiant : le compte exporté est celui de
 * la session. Le fichier est produit côté serveur puis remis au navigateur via
 * un Blob — jamais via une URL contenant des données personnelles.
 */
export function DataExportButton() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function download() {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const result = await exportAccountDataAction();
      if (!result.ok) {
        setError(result.message);
        return;
      }

      const blob = new Blob([result.content], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setDone(result.filename);
    });
  }

  return (
    <div className={styles.stack}>
      <p className={styles.note}>
        Tu récupères un fichier JSON : ton profil, tes clients, tes paiements à
        recevoir, tes tentatives de paiement, tes conversations et la fiche
        signalétique de tes documents.{" "}
        <span className={styles.noteStrong}>
          Le contenu des fichiers n’y est pas inclus
        </span>{" "}
        — il se télécharge depuis la fiche de chaque document.
      </p>

      <div className={styles.actions}>
        <Button
          type="button"
          variant="secondary"
          loading={pending}
          loadingLabel="Préparation de l’export…"
          onClick={download}
        >
          Télécharger mes données
        </Button>
      </div>

      {error ? (
        <p
          role="alert"
          className={`${formStyles.formStatus} ${formStyles.formError}`}
        >
          {error}
        </p>
      ) : null}
      {done ? (
        <p
          role="status"
          className={`${formStyles.formStatus} ${formStyles.formSuccess}`}
        >
          Export téléchargé ({done}).
        </p>
      ) : null}
    </div>
  );
}
