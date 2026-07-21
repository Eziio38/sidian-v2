import type { Database } from "@/types/database.generated";

type CreanceRow = Database["public"]["Tables"]["creance"]["Row"];
type PaiementRow = Database["public"]["Tables"]["paiement"]["Row"];
type TentativePaiementRow =
  Database["public"]["Tables"]["tentative_paiement"]["Row"];
type ApprovalRequestRow =
  Database["public"]["Tables"]["approval_request"]["Row"];
type DossierSuiviRow =
  Database["public"]["Tables"]["dossier_suivi"]["Row"];

export type DashboardReceivableSource = Pick<
  CreanceRow,
  | "id"
  | "client_payeur_id"
  | "montant"
  | "devise"
  | "date_echeance"
  | "etat"
  | "libelle"
  | "archived_at"
  | "created_at"
  | "updated_at"
>;

export type DashboardPaymentSource = Pick<
  PaiementRow,
  "id" | "creance_id" | "montant" | "source" | "created_at"
>;

export type DashboardAttemptSource = Pick<
  TentativePaiementRow,
  "id" | "creance_id" | "montant" | "etat" | "created_at"
>;

export type DashboardApprovalSource = Pick<
  ApprovalRequestRow,
  | "id"
  | "creance_id"
  | "type"
  | "status"
  | "created_at"
  | "decided_at"
  | "expires_at"
>;

export type DashboardCaseSource = Pick<
  DossierSuiviRow,
  "id" | "creance_id" | "etat" | "escalation_reason" | "updated_at"
>;

export type DashboardClientSource = {
  id: string;
  nom: string;
};

export type DashboardDeadline = {
  id: string;
  clientName: string;
  label: string;
  dueDate: string;
  totalCents: number;
  confirmedCents: number;
  outstandingCents: number;
  processingCents: number;
  status: "overdue" | "today" | "upcoming" | "disputed";
};

export type DashboardAction = {
  id: string;
  receivableId: string | null;
  target: "approvals" | "receivables";
  priority: "urgent" | "attention";
  title: string;
  description: string;
  createdAt: string;
};

export type DashboardEvent = {
  id: string;
  title: string;
  description: string;
  occurredAt: string;
  amountCents: number | null;
  tone: "neutral" | "success" | "warning" | "danger";
};

export type DashboardModel = {
  currency: "EUR";
  totals: {
    receivableCents: number;
    confirmedCents: number;
    processingCents: number;
    overdueCents: number;
    disputedCents: number;
    confirmedCount: number;
    processingCount: number;
    overdueCount: number;
  };
  portfolio: {
    activeCount: number;
    draftCount: number;
    disputeCount: number;
    nextDueDate: string | null;
    nextDueCents: number;
    nextDueCount: number;
  };
  deadlines: DashboardDeadline[];
  actions: DashboardAction[];
  events: DashboardEvent[];
};

export type DashboardModelInput = {
  today: string;
  now: string;
  receivables: DashboardReceivableSource[];
  payments: DashboardPaymentSource[];
  attempts: DashboardAttemptSource[];
  approvals: DashboardApprovalSource[];
  cases: DashboardCaseSource[];
  clients: DashboardClientSource[];
};

const OUTSTANDING_STATES = new Set<CreanceRow["etat"]>([
  "OUVERTE",
  "PARTIELLEMENT_REGLEE",
  "EN_LITIGE",
]);

const CASE_ACTIONS: Partial<
  Record<
    DossierSuiviRow["etat"],
    { priority: DashboardAction["priority"]; title: string }
  >
> = {
  ESCALADE_HUMAINE: {
    priority: "urgent",
    title: "Arbitrage humain requis",
  },
  PAUSE_LITIGE: {
    priority: "urgent",
    title: "Suivi en pause pour litige",
  },
  ATTENTE_PRESTATAIRE: {
    priority: "attention",
    title: "Votre réponse est attendue",
  },
};

function assertIsoDate(value: string, errorCode: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(errorCode);
  }
}

function assertCents(value: number, errorCode: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(errorCode);
  }
}

function addCents(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) {
    throw new Error("dashboard_amount_overflow");
  }
  return total;
}

function timestampValue(value: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error("dashboard_invalid_timestamp");
  }
  return timestamp;
}

function isPendingApproval(
  approval: DashboardApprovalSource,
  nowTimestamp: number,
): boolean {
  return (
    approval.status === "pending" &&
    (approval.expires_at === null ||
      timestampValue(approval.expires_at) > nowTimestamp)
  );
}

function approvalTitle(type: DashboardApprovalSource["type"]): string {
  switch (type) {
    case "formal_action":
      return "Valider une action formelle";
    case "rule_change":
      return "Confirmer un changement de règle";
    case "depassement_seuil":
      return "Examiner un dépassement de seuil";
    case "autre":
      return "Examiner la demande";
  }
}

function approvalEventTitle(
  approval: DashboardApprovalSource,
  nowTimestamp: number,
): { title: string; tone: DashboardEvent["tone"] } {
  if (approval.status === "pending") {
    if (
      approval.expires_at !== null &&
      timestampValue(approval.expires_at) <= nowTimestamp
    ) {
      return { title: "Demande arrivée à échéance", tone: "warning" };
    }
    return { title: "Validation demandée", tone: "warning" };
  }

  switch (approval.status) {
    case "approved":
      return { title: "Demande approuvée", tone: "success" };
    case "rejected":
      return { title: "Demande refusée", tone: "neutral" };
    case "expired":
      return { title: "Demande expirée", tone: "warning" };
  }
}

function eventForAttempt(
  attempt: DashboardAttemptSource,
): { title: string; tone: DashboardEvent["tone"] } | null {
  switch (attempt.etat) {
    case "EN_TRAITEMENT":
      return { title: "Paiement en traitement", tone: "warning" };
    case "ECHOUEE":
      return { title: "Tentative de paiement échouée", tone: "danger" };
    case "NECESSITE_ACTION_CLIENT":
      return { title: "Action demandée au client", tone: "warning" };
    case "ANNULEE":
      return { title: "Tentative de paiement annulée", tone: "neutral" };
    case "CREEE":
    case "REUSSIE":
      return null;
  }
}

export function buildDashboardModel({
  today,
  now,
  receivables,
  payments,
  attempts,
  approvals,
  cases,
  clients,
}: DashboardModelInput): DashboardModel {
  assertIsoDate(today, "dashboard_invalid_today");
  const nowTimestamp = timestampValue(now);
  const clientNames = new Map(clients.map((client) => [client.id, client.nom]));
  const receivableById = new Map(
    receivables.map((receivable) => [receivable.id, receivable]),
  );

  for (const receivable of receivables) {
    if (receivable.devise !== "EUR") {
      throw new Error("dashboard_unsupported_currency");
    }
    assertCents(receivable.montant, "dashboard_invalid_receivable_amount");
    assertIsoDate(receivable.date_echeance, "dashboard_invalid_due_date");
  }

  const confirmedByReceivable = new Map<string, number>();
  let confirmedCents = 0;
  for (const payment of payments) {
    if (!receivableById.has(payment.creance_id)) {
      throw new Error("dashboard_orphan_payment");
    }
    assertCents(payment.montant, "dashboard_invalid_payment_amount");
    confirmedCents = addCents(confirmedCents, payment.montant);
    confirmedByReceivable.set(
      payment.creance_id,
      addCents(
        confirmedByReceivable.get(payment.creance_id) ?? 0,
        payment.montant,
      ),
    );
  }

  const processingByReceivable = new Map<string, number>();
  let processingCents = 0;
  let processingCount = 0;
  for (const attempt of attempts) {
    if (!receivableById.has(attempt.creance_id)) {
      throw new Error("dashboard_orphan_attempt");
    }
    assertCents(attempt.montant, "dashboard_invalid_attempt_amount");
    if (attempt.etat !== "EN_TRAITEMENT") continue;

    processingCount += 1;
    processingCents = addCents(processingCents, attempt.montant);
    processingByReceivable.set(
      attempt.creance_id,
      addCents(
        processingByReceivable.get(attempt.creance_id) ?? 0,
        attempt.montant,
      ),
    );
  }

  const deadlines: DashboardDeadline[] = [];
  let receivableCents = 0;
  let overdueCents = 0;
  let overdueCount = 0;
  let disputedCents = 0;

  for (const receivable of receivables) {
    if (
      receivable.archived_at !== null ||
      !OUTSTANDING_STATES.has(receivable.etat)
    ) {
      continue;
    }

    const confirmed = confirmedByReceivable.get(receivable.id) ?? 0;
    const outstanding = Math.max(receivable.montant - confirmed, 0);
    if (outstanding === 0) continue;

    const isDisputed = receivable.etat === "EN_LITIGE";
    const status: DashboardDeadline["status"] = isDisputed
      ? "disputed"
      : receivable.date_echeance < today
        ? "overdue"
        : receivable.date_echeance === today
          ? "today"
          : "upcoming";

    receivableCents = addCents(receivableCents, outstanding);
    if (isDisputed) {
      disputedCents = addCents(disputedCents, outstanding);
    } else if (status === "overdue") {
      overdueCount += 1;
      overdueCents = addCents(overdueCents, outstanding);
    }

    deadlines.push({
      id: receivable.id,
      clientName:
        clientNames.get(receivable.client_payeur_id) ?? "Client non renseigné",
      label: receivable.libelle?.trim() || "Paiement à recevoir",
      dueDate: receivable.date_echeance,
      totalCents: receivable.montant,
      confirmedCents: confirmed,
      outstandingCents: outstanding,
      processingCents: processingByReceivable.get(receivable.id) ?? 0,
      status,
    });
  }

  deadlines.sort(
    (left, right) =>
      left.dueDate.localeCompare(right.dueDate) ||
      left.clientName.localeCompare(right.clientName, "fr"),
  );

  const activeReceivableIds = new Set(deadlines.map((deadline) => deadline.id));
  const actions: DashboardAction[] = [];
  const operationalActionByReceivable = new Set<string>();

  const describeReceivable = (receivableId: string | null): string => {
    if (receivableId === null) return "Décision liée à votre activité";
    const receivable = receivableById.get(receivableId);
    if (!receivable) return "Paiement à recevoir";
    const clientName =
      clientNames.get(receivable.client_payeur_id) ?? "Client non renseigné";
    const label = receivable.libelle?.trim() || "Paiement à recevoir";
    return `${clientName} · ${label}`;
  };

  for (const approval of approvals) {
    if (!isPendingApproval(approval, nowTimestamp)) continue;
    actions.push({
      id: `approval:${approval.id}`,
      receivableId: approval.creance_id,
      target: "approvals",
      priority: approval.type === "formal_action" ? "urgent" : "attention",
      title: approvalTitle(approval.type),
      description: describeReceivable(approval.creance_id),
      createdAt: approval.created_at,
    });
  }

  for (const deadline of deadlines) {
    if (deadline.status !== "disputed") continue;
    operationalActionByReceivable.add(deadline.id);
    actions.push({
      id: `dispute:${deadline.id}`,
      receivableId: deadline.id,
      target: "receivables",
      priority: "urgent",
      title: "Litige à examiner",
      description: `${deadline.clientName} · ${deadline.label}`,
      createdAt: receivableById.get(deadline.id)?.updated_at ?? now,
    });
  }

  const sortedCases = [...cases].sort((left, right) => {
    const leftAction = CASE_ACTIONS[left.etat];
    const rightAction = CASE_ACTIONS[right.etat];
    const priorityDifference =
      (leftAction?.priority === "urgent" ? 0 : 1) -
      (rightAction?.priority === "urgent" ? 0 : 1);
    return (
      priorityDifference ||
      timestampValue(left.updated_at) - timestampValue(right.updated_at)
    );
  });

  for (const dossier of sortedCases) {
    const action = CASE_ACTIONS[dossier.etat];
    if (
      !action ||
      !activeReceivableIds.has(dossier.creance_id) ||
      operationalActionByReceivable.has(dossier.creance_id)
    ) {
      continue;
    }
    operationalActionByReceivable.add(dossier.creance_id);
    actions.push({
      id: `case:${dossier.id}`,
      receivableId: dossier.creance_id,
      target: "receivables",
      priority: action.priority,
      title: action.title,
      description: describeReceivable(dossier.creance_id),
      createdAt: dossier.updated_at,
    });
  }

  const latestAttemptByReceivable = new Map<string, DashboardAttemptSource>();
  for (const attempt of attempts) {
    const current = latestAttemptByReceivable.get(attempt.creance_id);
    if (
      !current ||
      timestampValue(attempt.created_at) > timestampValue(current.created_at)
    ) {
      latestAttemptByReceivable.set(attempt.creance_id, attempt);
    }
  }

  for (const attempt of latestAttemptByReceivable.values()) {
    if (
      attempt.etat !== "ECHOUEE" ||
      !activeReceivableIds.has(attempt.creance_id) ||
      operationalActionByReceivable.has(attempt.creance_id)
    ) {
      continue;
    }
    operationalActionByReceivable.add(attempt.creance_id);
    actions.push({
      id: `attempt:${attempt.id}`,
      receivableId: attempt.creance_id,
      target: "receivables",
      priority: "attention",
      title: "Paiement échoué à reprendre",
      description: describeReceivable(attempt.creance_id),
      createdAt: attempt.created_at,
    });
  }

  actions.sort((left, right) => {
    const priorityDifference =
      (left.priority === "urgent" ? 0 : 1) -
      (right.priority === "urgent" ? 0 : 1);
    return (
      priorityDifference ||
      timestampValue(left.createdAt) - timestampValue(right.createdAt)
    );
  });

  const events: DashboardEvent[] = [];
  for (const payment of payments) {
    events.push({
      id: `payment:${payment.id}`,
      title: "Paiement confirmé",
      description: describeReceivable(payment.creance_id),
      occurredAt: payment.created_at,
      amountCents: payment.montant,
      tone: "success",
    });
  }

  for (const attempt of attempts) {
    const presentation = eventForAttempt(attempt);
    if (!presentation) continue;
    events.push({
      id: `attempt:${attempt.id}`,
      title: presentation.title,
      description: describeReceivable(attempt.creance_id),
      occurredAt: attempt.created_at,
      amountCents: attempt.montant,
      tone: presentation.tone,
    });
  }

  for (const approval of approvals) {
    const presentation = approvalEventTitle(approval, nowTimestamp);
    events.push({
      id: `approval:${approval.id}`,
      title: presentation.title,
      description: describeReceivable(approval.creance_id),
      occurredAt: approval.decided_at ?? approval.created_at,
      amountCents: null,
      tone: presentation.tone,
    });
  }

  for (const receivable of receivables) {
    events.push({
      id: `receivable:${receivable.id}`,
      title: "Paiement à recevoir créé",
      description: describeReceivable(receivable.id),
      occurredAt: receivable.created_at,
      amountCents: receivable.montant,
      tone: "neutral",
    });
    if (receivable.etat === "EN_LITIGE") {
      events.push({
        id: `dispute:${receivable.id}`,
        title: "Litige signalé",
        description: describeReceivable(receivable.id),
        occurredAt: receivable.updated_at,
        amountCents: null,
        tone: "danger",
      });
    }
  }

  events.sort(
    (left, right) =>
      timestampValue(right.occurredAt) - timestampValue(left.occurredAt) ||
      left.id.localeCompare(right.id),
  );

  const draftCount = receivables.filter(
    (receivable) =>
      receivable.archived_at === null && receivable.etat === "BROUILLON",
  ).length;
  const nextDueDate =
    deadlines.find(
      (deadline) =>
        deadline.status === "today" || deadline.status === "upcoming",
    )?.dueDate ?? null;
  const nextDueItems =
    nextDueDate === null
      ? []
      : deadlines.filter(
          (deadline) =>
            deadline.dueDate === nextDueDate && deadline.status !== "disputed",
        );

  return {
    currency: "EUR",
    totals: {
      receivableCents,
      confirmedCents,
      processingCents,
      overdueCents,
      disputedCents,
      confirmedCount: payments.length,
      processingCount,
      overdueCount,
    },
    portfolio: {
      activeCount: deadlines.length,
      draftCount,
      disputeCount: deadlines.filter(
        (deadline) => deadline.status === "disputed",
      ).length,
      nextDueDate,
      nextDueCents: nextDueItems.reduce(
        (total, deadline) => addCents(total, deadline.outstandingCents),
        0,
      ),
      nextDueCount: nextDueItems.length,
    },
    deadlines,
    actions,
    events: events.slice(0, 8),
  };
}
