import { PrepareLinkButton } from "@/components/app/prepare-link-button";
import { Badge, InfoCard } from "@/design-system";
import type { PrestataireStripeReadiness } from "@/lib/stripe/connect/readiness";
import type { Database } from "@/types/database.generated";

import styles from "./receivable-payment-section.module.css";

type CreanceEtat = Database["public"]["Enums"]["creance_etat"];

function formatMoney(cents: number, devise: string): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: devise,
  }).format(cents / 100);
}

const ETAT_BADGES: Record<
  CreanceEtat,
  { label: string; tone: "neutral" | "success" | "warning" | "danger" }
> = {
  BROUILLON: { label: "Brouillon", tone: "neutral" },
  OUVERTE: { label: "En attente", tone: "neutral" },
  PARTIELLEMENT_REGLEE: {
    label: "Partiellement réglé",
    tone: "warning",
  },
  REGLEE: { label: "Réglé", tone: "success" },
  EN_LITIGE: { label: "Litige", tone: "danger" },
  ANNULEE: { label: "Annulé", tone: "neutral" },
  IRRECOUVRABLE: { label: "Irrécouvrable", tone: "danger" },
};

function describeStripeReadiness(readiness: PrestataireStripeReadiness): {
  label: string;
  tone: "info" | "success" | "warning" | "danger";
} {
  if (readiness.chargesEnabled) {
    return { label: "Paiements activés", tone: "success" };
  }
  if (!readiness.configured) {
    return {
      label: "Encaissement non configuré — le lien ne sera pas partageable tant que ce n'est pas fait.",
      tone: "warning",
    };
  }
  switch (readiness.onboardingStatus) {
    case "action_requise":
      return { label: "Action requise pour activer l'encaissement", tone: "warning" };
    case "informations_requises":
      return { label: "Informations complémentaires requises par Stripe", tone: "warning" };
    case "verification_en_cours":
      return { label: "Vérification en cours chez Stripe", tone: "info" };
    case "paiements_indisponibles":
      return { label: "Paiements temporairement indisponibles", tone: "danger" };
    case "configuration_commencee":
      return { label: "Configuration Stripe commencée, encore incomplète", tone: "warning" };
    default:
      return { label: "Encaissement pas encore finalisé", tone: "warning" };
  }
}

/**
 * Section réutilisable de suivi paiement pour un « paiement à recevoir »
 * côté prestataire : montants, statut, lien public et disponibilité Stripe.
 */
export function ReceivablePaymentSection({
  creanceId,
  etat,
  montantTotalCents,
  montantRegleCents,
  devise,
  stripeReadiness,
}: {
  creanceId: string;
  etat: CreanceEtat;
  montantTotalCents: number;
  montantRegleCents: number;
  devise: string;
  stripeReadiness: PrestataireStripeReadiness;
}) {
  const soldeCents = montantTotalCents - montantRegleCents;
  const badge = ETAT_BADGES[etat];
  const readiness = describeStripeReadiness(stripeReadiness);
  const canPrepareLink = etat === "BROUILLON" || etat === "OUVERTE";

  return (
    <div className={styles.section}>
      <div className={styles.summary}>
        <dl className={styles.values}>
          <div>
            <dt className={styles.label}>Total</dt>
            <dd className={styles.value}>
              {formatMoney(montantTotalCents, devise)}
            </dd>
          </div>
          <div>
            <dt className={styles.label}>Réglé</dt>
            <dd className={styles.value}>
              {formatMoney(montantRegleCents, devise)}
            </dd>
          </div>
          <div>
            <dt className={styles.label}>Solde restant</dt>
            <dd className={styles.value}>
              {formatMoney(Math.max(soldeCents, 0), devise)}
            </dd>
          </div>
        </dl>
        <Badge tone={badge.tone}>
          {badge.label}
        </Badge>
      </div>

      <div className={styles.readiness}>
        <InfoCard
          density="compact"
          title="Encaissement"
          description={readiness.label}
          accessory={<Badge tone={readiness.tone}>État</Badge>}
        />
      </div>

      {canPrepareLink ? (
        <div className={styles.action}>
          <PrepareLinkButton creanceId={creanceId} />
        </div>
      ) : null}
    </div>
  );
}
