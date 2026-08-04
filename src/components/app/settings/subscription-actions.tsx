"use client";

import { useState, useTransition } from "react";

import {
  openSidianBillingPortalAction,
  startSidianSubscriptionAction,
} from "@/app/actions/billing";
import { Button } from "@/design-system";

import formStyles from "../form-layout.module.css";
import styles from "./settings.module.css";

type SubscriptionActionsProps = {
  canStart: boolean;
  canManage: boolean;
};

/**
 * Boutons d'abonnement.
 *
 * Ils ne sont rendus que si le droit correspondant est accordé côté serveur —
 * et le serveur revérifie de toute façon (`requireSubscriptionCapability`) :
 * masquer un bouton n'a jamais protégé quoi que ce soit.
 *
 * Les deux actions renvoient une URL Stripe ; la navigation est donc une sortie
 * du domaine (`assign`), pas un `router.push` interne.
 */
export function SubscriptionActions({
  canStart,
  canManage,
}: SubscriptionActionsProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!canStart && !canManage) return null;

  function run(action: () => Promise<{ ok: boolean; url?: string; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok && result.url) {
        window.location.assign(result.url);
        return;
      }
      // Aucun message inventé : c'est celui que l'action serveur a produit.
      setError(result.message ?? "Stripe n’a pas pu être joint.");
    });
  }

  return (
    <div className={styles.stack}>
      <div className={styles.actions}>
        {canStart ? (
          <Button
            type="button"
            loading={pending}
            loadingLabel="Ouverture de Stripe…"
            onClick={() => run(startSidianSubscriptionAction)}
          >
            Démarrer l’abonnement
          </Button>
        ) : null}
        {canManage ? (
          <Button
            type="button"
            variant="secondary"
            loading={pending}
            loadingLabel="Ouverture de Stripe…"
            onClick={() => run(openSidianBillingPortalAction)}
          >
            Gérer l’abonnement
          </Button>
        ) : null}
      </div>
      {error ? (
        <p
          role="alert"
          className={`${formStyles.formStatus} ${formStyles.formError}`}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
