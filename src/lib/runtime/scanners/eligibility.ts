/**
 * Prédicats d’éligibilité V2 — purs, horloge/policy injectées.
 */

import {
  WORKFLOW_POLICY,
  addUtcDays,
  type WorkflowPolicy,
  isDueReached,
  isInPreventionWindow,
  isSilenceWindowReached,
  resolveSilenceGraceDays,
} from "../workflow-policy";
import type {
  FailedTentativeSnapshot,
  OpenCreanceSnapshot,
  TerminalCreanceSnapshot,
} from "./candidates";

const OPEN_FINANCIAL = new Set(["OUVERTE", "PARTIELLEMENT_REGLEE"]);

const ACTIVE_DOSSIER = new Set([
  "PREVENTION",
  "ECHEANCE",
  "SUIVI_AMIABLE",
  "ATTENTE_CLIENT",
  "ATTENTE_PRESTATAIRE",
]);

/** Ancre silence = max(échéance, dernière activité client) en date civile. */
function silenceAnchorDate(row: OpenCreanceSnapshot): string {
  const activityDay = row.lastClientActivityAt?.slice(0, 10) ?? null;
  if (!activityDay) return row.dateEcheance;
  return activityDay > row.dateEcheance ? activityDay : row.dateEcheance;
}

export type EligibleOccurrence = {
  creanceId: string;
  prestataireId: string;
  dossierSuiviId: string | null;
  occurrenceKey: string;
  payload: Record<string, unknown>;
};

export function selectPreventionEligible(
  rows: OpenCreanceSnapshot[],
  today: string,
  policy: WorkflowPolicy = WORKFLOW_POLICY,
): EligibleOccurrence[] {
  const out: EligibleOccurrence[] = [];
  for (const row of rows) {
    if (!OPEN_FINANCIAL.has(row.etat)) continue;
    if (row.dossierEtat === "CLOS" || row.dossierEtat === "PAUSE_LITIGE") {
      continue;
    }
    if (row.soldeRestantCents <= 0) continue;
    if (
      !isInPreventionWindow({
        dueDate: row.dateEcheance,
        today,
        policy,
      })
    ) {
      continue;
    }
    out.push({
      creanceId: row.creanceId,
      prestataireId: row.prestataireId,
      dossierSuiviId: row.dossierSuiviId,
      occurrenceKey: row.dateEcheance,
      payload: {
        target_dossier_etat: "PREVENTION",
        notice_kind: "prevention_informative",
        date_echeance: row.dateEcheance,
        days_before_due: policy.prevention.daysBeforeDue,
      },
    });
  }
  return out;
}

export function selectDueEligible(
  rows: OpenCreanceSnapshot[],
  today: string,
  policy: WorkflowPolicy = WORKFLOW_POLICY,
): EligibleOccurrence[] {
  const out: EligibleOccurrence[] = [];
  for (const row of rows) {
    if (!OPEN_FINANCIAL.has(row.etat)) continue;
    if (row.dossierEtat === "CLOS" || row.dossierEtat === "PAUSE_LITIGE") {
      continue;
    }
    if (row.soldeRestantCents <= 0) continue;
    if (!isDueReached({ dueDate: row.dateEcheance, today, policy })) {
      continue;
    }
    // Lien non partageable : on enqueue quand même l’intention ;
    // le worker aval refusera l’envoi (03 §7) — pas d’appel transport ici.
    out.push({
      creanceId: row.creanceId,
      prestataireId: row.prestataireId,
      dossierSuiviId: row.dossierSuiviId,
      occurrenceKey: row.dateEcheance,
      payload: {
        target_dossier_etat: "ECHEANCE",
        send_payment_link: true,
        require_shareable: true,
        payment_link_shareable: row.paymentLinkShareable,
        date_echeance: row.dateEcheance,
      },
    });
  }
  return out;
}

export function selectSilenceEligible(
  rows: OpenCreanceSnapshot[],
  today: string,
  policy: WorkflowPolicy = WORKFLOW_POLICY,
): EligibleOccurrence[] {
  const out: EligibleOccurrence[] = [];
  for (const row of rows) {
    if (!OPEN_FINANCIAL.has(row.etat)) continue;
    if (row.dossierEtat === "CLOS") continue;
    if (row.dossierEtat === "ESCALADE_HUMAINE") continue;
    if (row.dossierEtat === "PAUSE_LITIGE") continue;
    if (row.dossierEtat && !ACTIVE_DOSSIER.has(row.dossierEtat)) continue;
    if (row.soldeRestantCents <= 0) continue;

    // Silence seulement après échéance (pas pendant la prévention).
    if (!isDueReached({ dueDate: row.dateEcheance, today, policy })) {
      continue;
    }

    const graceDays = resolveSilenceGraceDays(
      row.silenceGraceDaysFromRegle,
      policy,
    );
    const anchor = silenceAnchorDate(row);
    if (
      !isSilenceWindowReached({
        dueDate: anchor,
        today,
        graceDays,
      })
    ) {
      continue;
    }

    out.push({
      creanceId: row.creanceId,
      prestataireId: row.prestataireId,
      dossierSuiviId: row.dossierSuiviId,
      occurrenceKey: `${row.dateEcheance}:grace${graceDays}:${anchor}`,
      payload: {
        target_dossier_etat: "ESCALADE_HUMAINE",
        escalation_reason: "silence_prolonge",
        grace_days: graceDays,
        silence_anchor: anchor,
        silence_threshold: addUtcDays(anchor, graceDays),
        date_echeance: row.dateEcheance,
        never_irrecouvrable_automatic: true,
      },
    });
  }
  return out;
}

export function selectClosureEligible(
  rows: TerminalCreanceSnapshot[],
): EligibleOccurrence[] {
  const out: EligibleOccurrence[] = [];
  for (const row of rows) {
    if (row.dossierEtat === "CLOS") continue;
    // Pas de dossier : le worker créera/assurera puis clôturera.
    out.push({
      creanceId: row.creanceId,
      prestataireId: row.prestataireId,
      dossierSuiviId: row.dossierSuiviId,
      occurrenceKey: row.etat,
      payload: {
        target_dossier_etat: "CLOS",
        creance_etat: row.etat,
        date_echeance: row.dateEcheance,
      },
    });
  }
  return out;
}

export function selectAutoPayEligible(
  rows: OpenCreanceSnapshot[],
  today: string,
  policy: WorkflowPolicy = WORKFLOW_POLICY,
): EligibleOccurrence[] {
  const out: EligibleOccurrence[] = [];
  for (const row of rows) {
    if (!OPEN_FINANCIAL.has(row.etat)) continue;
    if (row.isPauseLitige || row.dossierEtat === "PAUSE_LITIGE") continue;
    if (row.dossierEtat === "CLOS") continue;
    if (row.soldeRestantCents <= 0) continue;
    if (!row.hasDefaultActiveAuthorization) continue;
    if (!isDueReached({ dueDate: row.dateEcheance, today, policy })) {
      continue;
    }
    out.push({
      creanceId: row.creanceId,
      prestataireId: row.prestataireId,
      dossierSuiviId: row.dossierSuiviId,
      occurrenceKey: row.dateEcheance,
      payload: {
        source: "prelevement_auto",
        checklist: [
          "creance_open_or_partial",
          "dossier_not_pause_litige",
          "amount_le_solde",
          "authorization_active_default",
          "regle_limits",
          "connect_payable",
          "stripe_scope",
        ],
        solde_restant_cents: row.soldeRestantCents,
        date_echeance: row.dateEcheance,
        // Intention only — worker créera tentative_paiement, pas Stripe ici.
        create_tentative_intent: true,
      },
    });
  }
  return out;
}

/**
 * MVP retry_policy = none : une tentative ÉCHOUÉE → une seule notification
 * / bascule lien manuel. Jamais de replay Stripe ambigu.
 */
export function selectRetriesEligible(
  rows: FailedTentativeSnapshot[],
  policy: WorkflowPolicy = WORKFLOW_POLICY,
): EligibleOccurrence[] {
  if (policy.retries.policy !== "none") {
    return [];
  }
  const out: EligibleOccurrence[] = [];
  for (const row of rows) {
    if (row.etat !== "ECHOUEE") continue;
    out.push({
      creanceId: row.creanceId,
      prestataireId: row.prestataireId,
      dossierSuiviId: row.dossierSuiviId,
      occurrenceKey: row.tentativeId,
      payload: {
        retry_policy: "none",
        tentative_id: row.tentativeId,
        action: "notify_prestataire_manual_link_fallback",
        never_replay_ambiguous_stripe: true,
        failed_at: row.failedAt,
      },
    });
  }
  return out;
}
