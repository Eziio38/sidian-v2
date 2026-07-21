import type { Database } from "@/types/database.generated";

type Payment = Pick<
  Database["public"]["Tables"]["paiement"]["Row"],
  "id" | "montant" | "source" | "created_at"
>;
type Attempt = Pick<
  Database["public"]["Tables"]["tentative_paiement"]["Row"],
  "id" | "montant" | "moyen" | "etat" | "created_at"
>;
type Audit = Pick<
  Database["public"]["Tables"]["audit_log"]["Row"],
  "id" | "action" | "actor_type" | "created_at"
>;

export type ReceivableTimelineEvent = {
  id: string;
  title: string;
  description: string;
  occurredAt: string;
  amountCents: number | null;
  tone: "neutral" | "success" | "warning" | "danger";
};

function safeAdd(left: number, right: number): number {
  if (!Number.isSafeInteger(right) || right <= 0) {
    throw new Error("receivable_invalid_amount");
  }
  const total = left + right;
  if (!Number.isSafeInteger(total)) {
    throw new Error("receivable_amount_overflow");
  }
  return total;
}

export function computeReceivableAmounts(
  totalCents: number,
  payments: Payment[],
  attempts: Attempt[],
): {
  confirmedCents: number;
  processingCents: number;
  remainingCents: number;
} {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
    throw new Error("receivable_invalid_total");
  }

  const confirmedCents = payments.reduce(
    (total, payment) => safeAdd(total, payment.montant),
    0,
  );
  const processingCents = attempts
    .filter((attempt) => attempt.etat === "EN_TRAITEMENT")
    .reduce((total, attempt) => safeAdd(total, attempt.montant), 0);

  return {
    confirmedCents,
    processingCents,
    remainingCents: Math.max(totalCents - confirmedCents, 0),
  };
}

function attemptPresentation(
  attempt: Attempt,
): Omit<ReceivableTimelineEvent, "id" | "occurredAt" | "amountCents"> {
  const rail = attempt.moyen === "sepa_core" ? "prélèvement SEPA" : "carte";
  switch (attempt.etat) {
    case "CREEE":
      return {
        title: "Paiement initié",
        description: `Une tentative par ${rail} a été préparée.`,
        tone: "neutral",
      };
    case "NECESSITE_ACTION_CLIENT":
      return {
        title: "Action demandée au client",
        description: `Le parcours ${rail} attend une action du client.`,
        tone: "warning",
      };
    case "EN_TRAITEMENT":
      return {
        title: "Paiement en traitement",
        description: `Le ${rail} n’est pas encore confirmé par Stripe.`,
        tone: "warning",
      };
    case "REUSSIE":
      return {
        title: "Tentative confirmée par Stripe",
        description: `La tentative par ${rail} a reçu un signal fiable.`,
        tone: "success",
      };
    case "ECHOUEE":
      return {
        title: "Tentative échouée",
        description: `Le ${rail} n’a pas abouti. Le solde confirmé reste inchangé.`,
        tone: "danger",
      };
    case "ANNULEE":
      return {
        title: "Tentative annulée",
        description: `La tentative par ${rail} est terminée sans paiement confirmé.`,
        tone: "neutral",
      };
  }
}

const AUDIT_TITLES: Record<string, string> = {
  PAYMENT_RECEIVABLE_OPENED: "Paiement à recevoir ouvert",
  PAYMENT_RECEIVABLE_CANCELLED: "Paiement à recevoir annulé",
  FOLLOW_UP_CASE_CREATED: "Dossier de suivi créé",
  FOLLOW_UP_CASE_UPDATED: "Dossier de suivi mis à jour",
  PAYMENT_DISPUTE_OPENED: "Contestation bancaire signalée",
  PAYMENT_SUCCEEDED_RECONCILIATION_REQUIRED: "Rapprochement humain demandé",
};

export function buildReceivableTimeline(
  payments: Payment[],
  attempts: Attempt[],
  audits: Audit[],
): ReceivableTimelineEvent[] {
  const paymentEvents: ReceivableTimelineEvent[] = payments.map((payment) => ({
    id: `payment-${payment.id}`,
    title: "Paiement confirmé",
    description:
      payment.source === "prelevement_auto"
        ? "Stripe a confirmé un paiement autorisé."
        : "Stripe a confirmé le règlement depuis le lien Sidian.",
    occurredAt: payment.created_at,
    amountCents: payment.montant,
    tone: "success",
  }));

  const attemptEvents: ReceivableTimelineEvent[] = attempts.map((attempt) => ({
    id: `attempt-${attempt.id}`,
    ...attemptPresentation(attempt),
    occurredAt: attempt.created_at,
    amountCents: attempt.montant,
  }));

  const auditEvents: ReceivableTimelineEvent[] = audits.map((audit) => ({
    id: `audit-${audit.id}`,
    title: AUDIT_TITLES[audit.action] ?? "Événement de suivi",
    description:
      audit.actor_type === "human"
        ? "Action enregistrée depuis votre espace Sidian."
        : "Action enregistrée par un service contrôlé.",
    occurredAt: audit.created_at,
    amountCents: null,
    tone: audit.action.includes("DISPUTE") ? "danger" : "neutral",
  }));

  return [...paymentEvents, ...attemptEvents, ...auditEvents].sort(
    (left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
  );
}
