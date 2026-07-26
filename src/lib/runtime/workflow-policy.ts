/**
 * Politique de calendrier runtime V2 — source unique des règles de timing.
 *
 * Autorité : SIDIAN_02 §4, SIDIAN_03 §7, runbook paiements.
 *
 * [DÉCISION — 26 juillet 2026]
 * Les offsets legacy J+5 / J+9 / J+10 / J+15 / J+17 (enrôlement obligatoire V1)
 * ne sont PAS des règles actives. Ils ne doivent jamais être réintroduits ici.
 *
 * Calendrier V2 actif :
 * - Prévention : fenêtre J-5 avant échéance (configurable, défaut 5 jours)
 * - Échéance : jour J (= date_echeance)
 * - Silence prolongé : délai de grâce post-échéance via `regle.delai_grace`
 *   (défaut policy), puis escalade humaine — jamais IRRECOUVRABLE auto
 * - Clôture : créance terminale → dossier CLOS
 * - Auto-pay : à l’échéance si checklist §4
 * - Retries tentative : `retry_policy = none` au MVP (03 §3.3)
 */

export const WORKFLOW_POLICY_VERSION = "2026-07-26.v1" as const;

export type RetryPolicyKind = "none";

export type WorkflowPolicy = {
  readonly version: typeof WORKFLOW_POLICY_VERSION;
  /** Fenêtre préventive : jours avant `date_echeance` (J-N). */
  readonly prevention: {
    readonly daysBeforeDue: number;
  };
  /** Déclenchement à l’échéance (offset 0 = jour J). */
  readonly due: {
    readonly dayOffsetFromDue: number;
  };
  /**
   * Silence prolongé après échéance sans activité client.
   * Valeur par défaut si aucune `regle.delai_grace` active.
   * Ce n’est PAS un offset legacy J+N d’enrôlement.
   */
  readonly silence: {
    readonly defaultGraceDaysAfterDue: number;
    /** Plancher si `regle.delai_grace` est absurde / trop bas. */
    readonly minGraceDays: number;
    /** Plafond défensif. */
    readonly maxGraceDays: number;
  };
  /** Auto-prélèvement : même jour que l’échéance (checklist 03 §4). */
  readonly autoPay: {
    readonly triggerOnDueDate: true;
  };
  /**
   * MVP : aucune reprise Stripe automatique.
   * Le scanner retries n’enqueue que des intentions de notification /
   * bascule lien manuel — jamais un appel Stripe.
   */
  readonly retries: {
    readonly policy: RetryPolicyKind;
  };
  readonly scanner: {
    readonly defaultBatchSize: number;
    readonly maxBatchSize: number;
    readonly defaultLeaseSeconds: number;
    readonly minLeaseSeconds: number;
    readonly maxLeaseSeconds: number;
  };
};

/**
 * Règles de timing versionnées — seule source autorisée pour les scanners.
 */
export const WORKFLOW_POLICY: WorkflowPolicy = {
  version: WORKFLOW_POLICY_VERSION,
  prevention: {
    daysBeforeDue: 5,
  },
  due: {
    dayOffsetFromDue: 0,
  },
  silence: {
    // Hypothèse opérationnelle V2 (regle.delai_grace) — pas un offset V1.
    defaultGraceDaysAfterDue: 14,
    minGraceDays: 3,
    maxGraceDays: 90,
  },
  autoPay: {
    triggerOnDueDate: true,
  },
  retries: {
    policy: "none",
  },
  scanner: {
    defaultBatchSize: 50,
    maxBatchSize: 200,
    defaultLeaseSeconds: 120,
    minLeaseSeconds: 30,
    maxLeaseSeconds: 600,
  },
} as const;

/** Offsets legacy explicitement rejetés (documentation + garde tests). */
export const REJECTED_LEGACY_ENROLLMENT_OFFSETS_DAYS = [
  5, 9, 10, 15, 17,
] as const;

export type WorkflowJobKind =
  | "prevention_notice"
  | "due_send_link"
  | "silence_escalate"
  | "closure_close_dossier"
  | "autopay_intent"
  | "retry_failed_notify";

export type WorkflowScannerKind =
  | "prevention"
  | "due"
  | "silence"
  | "closure"
  | "auto_pay"
  | "retries";

export const SCANNER_TO_JOB_KIND: Record<
  WorkflowScannerKind,
  WorkflowJobKind
> = {
  prevention: "prevention_notice",
  due: "due_send_link",
  silence: "silence_escalate",
  closure: "closure_close_dossier",
  auto_pay: "autopay_intent",
  retries: "retry_failed_notify",
};

/**
 * Borne un délai de grâce silence (jours) dans les limites policy.
 */
export function clampSilenceGraceDays(
  rawDays: number,
  policy: WorkflowPolicy = WORKFLOW_POLICY,
): number {
  if (!Number.isFinite(rawDays)) {
    return policy.silence.defaultGraceDaysAfterDue;
  }
  const rounded = Math.trunc(rawDays);
  return Math.min(
    policy.silence.maxGraceDays,
    Math.max(policy.silence.minGraceDays, rounded),
  );
}

/**
 * Résout le délai de grâce silence : regle prestataire/client ou défaut policy.
 */
export function resolveSilenceGraceDays(
  regleDays: number | null | undefined,
  policy: WorkflowPolicy = WORKFLOW_POLICY,
): number {
  if (regleDays == null) {
    return policy.silence.defaultGraceDaysAfterDue;
  }
  return clampSilenceGraceDays(regleDays, policy);
}

/**
 * Date civile UTC (YYYY-MM-DD) depuis une horloge injectée.
 */
export function utcCalendarDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Ajoute/soustrait des jours à une date civile YYYY-MM-DD (UTC).
 */
export function addUtcDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Fenêtre préventive inclusive : [due - N, due - 1] en dates civiles UTC.
 * Au jour J l’échéance prend le relais (scanner due), pas la prévention.
 */
export function isInPreventionWindow(input: {
  dueDate: string;
  today: string;
  policy?: WorkflowPolicy;
}): boolean {
  const policy = input.policy ?? WORKFLOW_POLICY;
  const windowStart = addUtcDays(
    input.dueDate,
    -policy.prevention.daysBeforeDue,
  );
  const windowEnd = addUtcDays(input.dueDate, -1);
  return input.today >= windowStart && input.today <= windowEnd;
}

/** Échéance atteinte (jour J + offset policy, défaut 0). */
export function isDueReached(input: {
  dueDate: string;
  today: string;
  policy?: WorkflowPolicy;
}): boolean {
  const policy = input.policy ?? WORKFLOW_POLICY;
  const triggerDate = addUtcDays(
    input.dueDate,
    policy.due.dayOffsetFromDue,
  );
  return input.today >= triggerDate;
}

/** Silence : aujourd’hui ≥ échéance + grâce. */
export function isSilenceWindowReached(input: {
  dueDate: string;
  today: string;
  graceDays: number;
}): boolean {
  const threshold = addUtcDays(input.dueDate, input.graceDays);
  return input.today >= threshold;
}

/**
 * Clé d’idempotence stable par occurrence métier.
 * Empêche le double-enqueue même sous scans concurrents.
 */
export function buildJobIdempotencyKey(input: {
  jobKind: WorkflowJobKind;
  creanceId: string;
  /** Ancre métier : date_echeance ou tentative_id selon le kind. */
  occurrenceKey: string;
}): string {
  return `${input.jobKind}:${input.creanceId}:${input.occurrenceKey}`;
}
