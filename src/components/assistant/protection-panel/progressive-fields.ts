/**
 * Révélation progressive des champs — pure présentation.
 * S’appuie sur les valeurs déjà validées / fournies par le backend.
 */

import {
  FIELD_LABELS,
  PLACEHOLDERS,
} from "./microcopy";
import type {
  ProtectionPanelData,
  ProtectionPanelField,
  ProtectionPanelFieldId,
} from "./types";

function hasText(value: string | undefined | null): boolean {
  return Boolean(value && value.trim() && value.trim() !== "—" && value.trim() !== PLACEHOLDERS.client);
}

function isFilledAmount(value: string | undefined): boolean {
  if (!value) return false;
  const t = value.trim();
  return t.length > 0 && t !== "—" && t !== PLACEHOLDERS.amount;
}

function isFilledDue(value: string | undefined): boolean {
  if (!value) return false;
  const t = value.trim();
  return t.length > 0 && t !== "—" && t !== PLACEHOLDERS.due_date;
}

/**
 * Détermine quelles sections afficher selon l’avancement du dossier.
 * Ordre fixe : client → montant → échéance → moyen → autorisation → auto-débit → statut.
 * Actions / conséquences sont gérées hors liste (pied de panneau).
 */
export function selectProgressiveFields(
  data: ProtectionPanelData,
): ProtectionPanelField[] {
  const isActiveLike =
    data.status === "active" || data.status === "blocked";
  const clientReady = hasText(data.clientName);
  const amountReady = isFilledAmount(data.amountLabel);
  const dueReady = isFilledDue(data.dueDateLabel);

  const fields: ProtectionPanelField[] = [];

  const push = (
    id: Exclude<
      ProtectionPanelFieldId,
      "actions" | "consequences"
    >,
    value: string,
    pending?: boolean,
  ) => {
    fields.push({
      id,
      label: FIELD_LABELS[id === "status" ? "status" : id],
      value,
      pending,
      emphasize: id === "amount" ? "amount" : "default",
    });
  };

  // Client — toujours visible dès l’ouverture
  push(
    "client",
    clientReady ? data.clientName : PLACEHOLDERS.client,
    !clientReady,
  );

  // Montant — après un début de client, ou si déjà connu
  if (clientReady || amountReady || data.status === "draft") {
    push(
      "amount",
      amountReady ? data.amountLabel : PLACEHOLDERS.amount,
      !amountReady,
    );
  }

  // Échéance — après montant, ou déjà connue
  if (amountReady || dueReady) {
    push(
      "due_date",
      dueReady ? (data.dueDateLabel as string) : PLACEHOLDERS.due_date,
      !dueReady,
    );
  }

  // Moyen / autorisation / auto-débit — après échéance, ou dossier déjà créé
  if (dueReady || isActiveLike) {
    push(
      "payment_method",
      data.paymentMethodLabel?.trim() || PLACEHOLDERS.payment_method,
      !data.paymentMethodLabel?.trim(),
    );
    push(
      "authorization",
      data.authorizationLabel?.trim() || PLACEHOLDERS.authorization,
      !data.authorizationLabel?.trim(),
    );
    push(
      "auto_debit",
      data.autoDebitRuleLabel?.trim() || PLACEHOLDERS.auto_debit,
      !data.autoDebitRuleLabel?.trim(),
    );
  }

  // Statut — toujours
  push("status", data.statusLabel, false);

  return fields;
}

/** Prochaine étape — séparée pour le pied de panneau / tests. */
export function selectNextStepLabel(data: ProtectionPanelData): string | null {
  const value = data.nextStepLabel?.trim();
  return value || null;
}
