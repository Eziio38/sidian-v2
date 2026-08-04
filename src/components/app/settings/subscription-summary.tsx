import type { SubscriptionState } from "@/lib/subscription";

import { SubscriptionActions } from "./subscription-actions";
import styles from "./settings.module.css";

/**
 * État réel de l'abonnement, lu sur `prestataire` et sur la liaison Stripe.
 *
 * Rien n'est composé ici qui ne vienne de la base : aucun nom d'offre, aucun
 * prix, aucun quota. Le dépôt ne connaît qu'un identifiant de version tarifaire
 * (`pricing_version`) — l'afficher tel quel est la seule façon honnête de le
 * restituer, et `docs/SIDIAN_02_PRD_V2.md` §6 marque la grille d'offres comme
 * « HYPOTHÈSE — non engagée ».
 */

export type SubscriptionSummaryProps = {
  state: SubscriptionState;
  billingConfigured: boolean;
  canStartSubscription: boolean;
  canManageSubscription: boolean;
  /** Déjà formatées côté serveur : évite toute divergence d'hydratation. */
  currentPeriodEndLabel: string | null;
  cancelAtPeriodEnd: boolean;
  pricingVersion: string;
  subscriptionStartedAtLabel: string | null;
  earlyAccessLockedUntilLabel: string | null;
};

const STATE_LABEL: Record<SubscriptionState, string> = {
  billing_unavailable: "Non configuré",
  no_subscription: "Aucun abonnement",
  trialing: "Période d’essai",
  active: "Actif",
  past_due: "Paiement en retard",
  cancelled: "Résilié",
};

const STATE_DESCRIPTION: Record<SubscriptionState, string> = {
  billing_unavailable:
    "La gestion de l’abonnement n’est pas configurée sur cet environnement. Rien ne peut être souscrit, modifié ni résilié depuis cet écran.",
  no_subscription:
    "Aucun abonnement Stripe n’est rattaché à ce compte. L’accès au produit reste ouvert.",
  trialing: "Ton abonnement Stripe est en période d’essai.",
  active: "Ton abonnement Stripe est actif.",
  past_due:
    "Le dernier prélèvement n’a pas abouti. Mets à jour ton moyen de paiement pour éviter une interruption.",
  cancelled: "Ton abonnement est résilié.",
};

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.fact}>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={styles.factValue}>{value}</dd>
    </div>
  );
}

export function SubscriptionSummary({
  state,
  billingConfigured,
  canStartSubscription,
  canManageSubscription,
  currentPeriodEndLabel,
  cancelAtPeriodEnd,
  pricingVersion,
  subscriptionStartedAtLabel,
  earlyAccessLockedUntilLabel,
}: SubscriptionSummaryProps) {
  return (
    <div className={styles.stack}>
      <dl className={styles.factList}>
        <Fact label="État" value={STATE_LABEL[state]} />
        <Fact label="Version tarifaire enregistrée" value={pricingVersion} />
        {subscriptionStartedAtLabel ? (
          <Fact label="Démarré le" value={subscriptionStartedAtLabel} />
        ) : null}
        {currentPeriodEndLabel ? (
          <Fact
            label={
              cancelAtPeriodEnd
                ? "Se termine le"
                : "Prochaine échéance de facturation"
            }
            value={currentPeriodEndLabel}
          />
        ) : null}
        {/*
          Aucune promesse tarifaire n'est affichée si la base n'en porte pas :
          `early_access_price_locked_until` est renseigné par la facturation,
          et la durée du verrouillage reste une décision commerciale en attente
          (voir src/lib/stripe/billing/env.ts).
        */}
        {earlyAccessLockedUntilLabel ? (
          <Fact
            label="Tarif Early Access garanti jusqu’au"
            value={earlyAccessLockedUntilLabel}
          />
        ) : null}
      </dl>

      <p className={styles.note}>{STATE_DESCRIPTION[state]}</p>

      {billingConfigured ? (
        <SubscriptionActions
          canStart={canStartSubscription}
          canManage={canManageSubscription}
        />
      ) : null}
    </div>
  );
}
