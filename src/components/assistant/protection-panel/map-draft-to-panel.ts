/**
 * Mapping sortie API protection.draft.* → modèle de vue panneau.
 * Formatage d’affichage uniquement — aucune règle métier.
 */

import {
  ACTION_LABELS,
  CONSEQUENCE_COPY,
  PLACEHOLDERS,
  mapBackendStateToPanelStatus,
  statusLabelFor,
} from "./microcopy";
import type {
  ProtectionDraftConfirmOutput,
  ProtectionDraftToolOutput,
  ProtectionPanelData,
  ProtectionPanelStatus,
} from "./types";

function formatAmountMinor(
  minor: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) {
    return PLACEHOLDERS.amount;
  }
  const euros = minor / 100;
  const formatted = new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: currency && currency.length === 3 ? currency : "EUR",
    maximumFractionDigits: euros % 1 === 0 ? 0 : 2,
  }).format(euros);
  return formatted;
}

function formatDueDate(iso: string | null | undefined): string {
  if (!iso) return PLACEHOLDERS.due_date;
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return iso;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function nextStepFromOutput(output: ProtectionDraftToolOutput): string {
  if (output.pending_question?.trim()) {
    return output.pending_question.trim();
  }
  if (output.confirmation_nonce) {
    return "Vérifie le récapitulatif puis confirme pour créer la protection.";
  }
  if (output.missing_fields.length > 0) {
    return PLACEHOLDERS.next_step;
  }
  return "Prêt à confirmer.";
}

function primaryActionFor(
  status: ProtectionPanelStatus,
  confirmationNonce: string | null,
): string | undefined {
  if (status === "error") return ACTION_LABELS.retry;
  if (status === "active") return ACTION_LABELS.view;
  if (status === "blocked") return undefined;
  if (confirmationNonce) return ACTION_LABELS.confirm;
  return ACTION_LABELS.create;
}

/**
 * Convertit une sortie outil protection.draft.* en données panneau.
 */
export function mapDraftOutputToPanel(
  output: ProtectionDraftToolOutput,
  options?: {
    statusOverride?: ProtectionPanelStatus;
    paymentMethodLabel?: string;
    authorizationLabel?: string;
    autoDebitRuleLabel?: string;
  },
): ProtectionPanelData {
  const status =
    options?.statusOverride ?? mapBackendStateToPanelStatus(output.state);
  const clientName =
    output.recap.client_name?.trim() || PLACEHOLDERS.client;

  return {
    draftId: output.draft_id,
    confirmationNonce: output.confirmation_nonce,
    backendState: output.state,
    missingFields: output.missing_fields,
    pendingQuestion: output.pending_question,
    clientName,
    clientEmail: output.recap.client_email ?? undefined,
    status,
    statusLabel: statusLabelFor(status),
    amountLabel: formatAmountMinor(
      output.recap.expected_amount_minor,
      output.recap.currency,
    ),
    subject: output.recap.libelle ?? undefined,
    dueDateLabel: formatDueDate(output.recap.due_date),
    paymentMethodLabel: options?.paymentMethodLabel,
    authorizationLabel: options?.authorizationLabel,
    autoDebitRuleLabel: options?.autoDebitRuleLabel,
    nextStepLabel: nextStepFromOutput(output),
    consequenceLabel: CONSEQUENCE_COPY[status],
    primaryActionLabel: primaryActionFor(status, output.confirmation_nonce),
    secondaryActionLabel:
      status === "draft" ? ACTION_LABELS.cancel_draft : undefined,
  };
}

/**
 * Après confirm réussi — panneau en lecture « active ».
 * Les ids métier restent des références ; libellés soft côté UI.
 */
export function mapConfirmOutputToPanel(
  confirm: ProtectionDraftConfirmOutput,
  previous: ProtectionPanelData,
): ProtectionPanelData {
  return {
    ...previous,
    draftId: confirm.draft_id,
    confirmationNonce: null,
    backendState: confirm.state,
    status: "active",
    statusLabel: statusLabelFor("active"),
    paymentMethodLabel:
      previous.paymentMethodLabel ??
      "Carte ou prélèvement — au choix du client",
    authorizationLabel:
      previous.authorizationLabel ?? "Sera proposée au premier paiement",
    autoDebitRuleLabel:
      previous.autoDebitRuleLabel ?? "Activable après autorisation du client",
    nextStepLabel: "Suivi à l’échéance",
    consequenceLabel: CONSEQUENCE_COPY.active,
    primaryActionLabel: ACTION_LABELS.view,
    secondaryActionLabel: undefined,
  };
}

export function panelDataToErrorState(
  previous: ProtectionPanelData,
  message?: string,
): ProtectionPanelData {
  return {
    ...previous,
    status: "error",
    statusLabel: statusLabelFor("error"),
    nextStepLabel: message?.trim() || CONSEQUENCE_COPY.error,
    consequenceLabel: CONSEQUENCE_COPY.error,
    primaryActionLabel: ACTION_LABELS.retry,
  };
}
