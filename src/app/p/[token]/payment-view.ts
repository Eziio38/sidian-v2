import type { SidianPaymentRail } from "@/lib/stripe/connect/retrieve-and-sync";

export type PublicPaymentViewInput = {
  payable: boolean;
  reason?: string;
  montant: number;
  amountPaid: number;
  remaining: number;
  prestataireNom: string | null;
  libelle: string | null;
  referenceExterne: string | null;
  dateEcheance: string | null;
  pendingMoyen: string | null;
  availableRails: SidianPaymentRail[];
};

export type PublicPaymentView = {
  providerName: string;
  label: string;
  reference: string | null;
  dueDate: string | null;
  total: string;
  paid: string;
  remaining: string;
  statusLabel: string;
  stateTitle: string | null;
  stateDescription: string | null;
  railLabels: string[];
};

const RAIL_LABELS: Record<SidianPaymentRail, string> = {
  card: "Carte bancaire",
  sepa_core: "Prélèvement SEPA",
};

const UNAVAILABLE_STATES: Record<
  string,
  Pick<PublicPaymentView, "statusLabel" | "stateTitle" | "stateDescription">
> = {
  settled: {
    statusLabel: "Réglé",
    stateTitle: "Ce paiement est réglé",
    stateDescription: "Aucun nouveau règlement n’est nécessaire.",
  },
  pending_payment: {
    statusLabel: "En cours de traitement",
    stateTitle: "Un règlement est en cours",
    stateDescription:
      "La confirmation peut prendre quelques instants, ou plusieurs jours ouvrés pour un prélèvement bancaire.",
  },
  archived: {
    statusLabel: "Indisponible",
    stateTitle: "Ce paiement n’est plus disponible",
    stateDescription: "Contactez le prestataire si vous pensez qu’il s’agit d’une erreur.",
  },
  not_open: {
    statusLabel: "Indisponible",
    stateTitle: "Ce paiement n’est plus disponible",
    stateDescription: "Contactez le prestataire si vous pensez qu’il s’agit d’une erreur.",
  },
  account_not_configured: {
    statusLabel: "Bientôt disponible",
    stateTitle: "Le paiement en ligne n’est pas encore activé",
    stateDescription: "Réessayez un peu plus tard ou contactez le prestataire.",
  },
  account_not_payable: {
    statusLabel: "Temporairement indisponible",
    stateTitle: "Aucun moyen de paiement n’est disponible",
    stateDescription: "Réessayez un peu plus tard ou contactez le prestataire.",
  },
  account_check_unavailable: {
    statusLabel: "Vérification en attente",
    stateTitle: "Nous ne pouvons pas vérifier le paiement maintenant",
    stateDescription: "Aucun règlement n’a été lancé. Réessayez dans quelques instants.",
  },
  unsupported_currency: {
    statusLabel: "Indisponible",
    stateTitle: "Ce paiement ne peut pas être traité",
    stateDescription: "Sidian accepte uniquement les règlements en euros pour le moment.",
  },
};

export function formatEuro(cents: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

export function formatDueDate(dateEcheance: string | null): string | null {
  if (!dateEcheance || !/^\d{4}-\d{2}-\d{2}$/.test(dateEcheance)) return null;
  const [year, month, day] = dateEcheance.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

export function buildPublicPaymentView(
  input: PublicPaymentViewInput,
): PublicPaymentView {
  const unavailable = input.reason
    ? (UNAVAILABLE_STATES[input.reason] ?? UNAVAILABLE_STATES.not_open)
    : null;
  const statusLabel = input.payable
    ? input.amountPaid > 0
      ? "Partiellement réglé"
      : "À régler"
    : unavailable?.statusLabel ?? "Indisponible";

  return {
    providerName: input.prestataireNom?.trim() || "Votre prestataire",
    label: input.libelle?.trim() || "Paiement à recevoir",
    reference: input.referenceExterne?.trim() || null,
    dueDate: formatDueDate(input.dateEcheance),
    total: formatEuro(Math.max(0, input.montant)),
    paid: formatEuro(Math.max(0, input.amountPaid)),
    remaining: formatEuro(Math.max(0, input.remaining)),
    statusLabel,
    stateTitle: unavailable?.stateTitle ?? null,
    stateDescription:
      input.reason === "pending_payment" && input.pendingMoyen === "sepa_core"
        ? "Le prélèvement bancaire est en attente de confirmation. Cela peut prendre plusieurs jours ouvrés."
        : (unavailable?.stateDescription ?? null),
    railLabels: input.availableRails.map((rail) => RAIL_LABELS[rail]),
  };
}
