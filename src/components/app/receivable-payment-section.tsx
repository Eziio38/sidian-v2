import { PrepareLinkButton } from "@/components/app/prepare-link-button";
import type { PrestataireStripeReadiness } from "@/lib/stripe/connect/readiness";
import type { Database } from "@/types/database.generated";

type CreanceEtat = Database["public"]["Enums"]["creance_etat"];

function formatMoney(cents: number, devise: string): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: devise,
  }).format(cents / 100);
}

const ETAT_BADGES: Record<
  CreanceEtat,
  { label: string; className: string }
> = {
  BROUILLON: { label: "Brouillon", className: "bg-gris-100 text-gris-500" },
  OUVERTE: { label: "En attente", className: "bg-gris-100 text-gris-500" },
  PARTIELLEMENT_REGLEE: {
    label: "Partiellement réglé",
    className: "bg-amber-50 text-amber-700",
  },
  REGLEE: { label: "Réglé", className: "bg-emerald-50 text-emerald-700" },
  EN_LITIGE: { label: "Litige", className: "bg-red-50 text-red-700" },
  ANNULEE: { label: "Annulé", className: "bg-gris-100 text-gris-500" },
  IRRECOUVRABLE: { label: "Irrécouvrable", className: "bg-red-50 text-red-700" },
};

function describeStripeReadiness(readiness: PrestataireStripeReadiness): {
  label: string;
  className: string;
} {
  if (readiness.chargesEnabled) {
    return { label: "Paiements activés", className: "bg-emerald-50 text-emerald-700" };
  }
  if (!readiness.configured) {
    return {
      label: "Encaissement non configuré — le lien ne sera pas partageable tant que ce n'est pas fait.",
      className: "bg-amber-50 text-amber-700",
    };
  }
  switch (readiness.onboardingStatus) {
    case "action_requise":
      return { label: "Action requise pour activer l'encaissement", className: "bg-amber-50 text-amber-700" };
    case "informations_requises":
      return { label: "Informations complémentaires requises par Stripe", className: "bg-amber-50 text-amber-700" };
    case "verification_en_cours":
      return { label: "Vérification en cours chez Stripe", className: "bg-gris-100 text-gris-500" };
    case "paiements_indisponibles":
      return { label: "Paiements temporairement indisponibles", className: "bg-red-50 text-red-700" };
    case "configuration_commencee":
      return { label: "Configuration Stripe commencée, encore incomplète", className: "bg-amber-50 text-amber-700" };
    default:
      return { label: "Encaissement pas encore finalisé", className: "bg-amber-50 text-amber-700" };
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
    <div className="space-y-3 rounded-xl border border-gris-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <dl className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-gris-500">Total</dt>
            <dd className="font-semibold tabular-nums text-nuit">
              {formatMoney(montantTotalCents, devise)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gris-500">Réglé</dt>
            <dd className="font-semibold tabular-nums text-nuit">
              {formatMoney(montantRegleCents, devise)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gris-500">Solde restant</dt>
            <dd className="font-semibold tabular-nums text-nuit">
              {formatMoney(Math.max(soldeCents, 0), devise)}
            </dd>
          </div>
        </dl>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${badge.className}`}
        >
          {badge.label}
        </span>
      </div>

      <div className="border-t border-gris-100 pt-3">
        <p className={`rounded-lg px-3 py-2 text-xs ${readiness.className}`}>
          {readiness.label}
        </p>
      </div>

      {canPrepareLink ? (
        <div className="border-t border-gris-100 pt-3">
          <PrepareLinkButton creanceId={creanceId} />
        </div>
      ) : null}
    </div>
  );
}
