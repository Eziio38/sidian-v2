import type { TemplateVariablesByKey } from "../../email/templates/registry";
import type { EmailTemplateKey } from "../../email/types";
import type {
  WorkflowJobKind,
  WorkflowScannerKind,
} from "../workflow-policy";

export type RuntimeJobStatus =
  | "pending"
  | "claimed"
  | "completed"
  | "failed_retryable"
  | "failed_terminal"
  | "cancelled";

export type RuntimeJobRecord = {
  id: string;
  prestataireId: string;
  creanceId: string;
  dossierSuiviId: string | null;
  scannerKind: WorkflowScannerKind;
  jobKind: WorkflowJobKind;
  policyVersion: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  status: RuntimeJobStatus;
  availableAt: string;
  createdAt: string;
};

export type EnqueueRuntimeJobInput = {
  prestataireId: string;
  creanceId: string;
  dossierSuiviId: string | null;
  scannerKind: WorkflowScannerKind;
  jobKind: WorkflowJobKind;
  policyVersion: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  availableAt?: string;
  now: string;
};

export type EnqueueRuntimeJobResult = {
  enqueued: boolean;
  duplicate: boolean;
  jobId: string;
  status: RuntimeJobStatus;
};

/** Job claimé : porte le jeton de lease qui autorise l'acquittement. */
export type ClaimedRuntimeJob = RuntimeJobRecord & {
  leaseToken: string;
  leaseExpiresAt: string;
  attemptCount: number;
};

export type ClaimRuntimeJobsInput = {
  now: string;
  leaseSeconds: number;
  batchSize: number;
  /**
   * Types de jobs réellement consommables.
   *
   * Volontairement obligatoire : un consommateur ne doit claimer que ce qu'il
   * sait traiter. Claimer un type sans handler consommerait une tentative et
   * finirait par le marquer en échec terminal — l'intention métier serait
   * perdue alors qu'il ne s'agit que d'un câblage manquant.
   */
  jobKinds: readonly WorkflowJobKind[];
};

export type FailRuntimeJobInput = {
  jobId: string;
  leaseToken: string;
  errorCode: string;
  /** `false` = échec définitif, sans nouvelle tentative. */
  retryable: boolean;
  maxAttempts?: number;
  backoffBaseSeconds?: number;
  now: string;
};

export type FailRuntimeJobOutcome =
  | "failed_retryable"
  | "failed_terminal"
  | "lease_lost";

/** Résultat de la clôture de dossier pilotée par le runtime. */
export type RuntimeCloseDossierOutcome =
  | "closed"
  | "already_closed"
  | "creance_not_found"
  | "creance_not_terminal"
  | "transition_forbidden";

/**
 * Contexte métier nécessaire au rendu d'une relance — image de
 * `runtime_load_job_context`.
 *
 * `paymentLinkUrl` est toujours `null` : `payment_link` ne conserve que
 * l'empreinte du jeton opaque, et le jeton brut n'est restitué qu'une fois, à
 * la création du lien. L'URL `/p/<token>` d'un lien déjà émis n'est donc pas
 * reconstituable côté serveur. Le champ existe pour rendre ce constat explicite
 * — jamais pour être fabriqué à partir de `paymentLinkId`.
 */
export type RuntimeJobContext = {
  creanceId: string;
  prestataireId: string;
  prestataireNom: string;
  clientPayeurId: string;
  clientNom: string;
  clientEmail: string;
  montantCents: number;
  devise: string;
  /** Date civile `YYYY-MM-DD`. */
  dateEcheance: string;
  etat: string;
  paymentLinkActive: boolean;
  paymentLinkId: string | null;
  paymentLinkUrl: string | null;
  /**
   * Préférences de notification du prestataire, transportées avec le contexte
   * pour que la décision d'envoyer se prenne sur les mêmes données que le
   * rendu du message. `true` par défaut : un compte qui n'a jamais ouvert
   * Paramètres reçoit tout.
   */
  notifyReminderBeforeDue: boolean;
  notifyPaymentFailed: boolean;
};

/** Intention d'envoi produite par un handler de relance. */
export type RelanceEmailRequest<
  K extends EmailTemplateKey = EmailTemplateKey,
> = {
  /** Toujours le `prestataire_id` du job — jamais un identifiant d'appelant. */
  tenantId: string;
  templateKey: K;
  recipient: { email: string; name?: string };
  variables: TemplateVariablesByKey[K];
  relatedEntityId: string;
  /** Dérivée de `runtime_job.idempotency_key` : un rejeu n'envoie jamais deux fois. */
  idempotencyKey: string;
};

/**
 * Disponibilité honnête du canal email.
 *
 * Un canal indisponible n'est jamais masqué : le handler remonte le code
 * d'erreur tel quel plutôt que d'acquitter un envoi qui n'a pas eu lieu.
 */
export type RelanceMailerStatus =
  | { available: true }
  | { available: false; errorCode: string };

export type RelanceMailer = {
  status(): RelanceMailerStatus;
  enqueue<K extends EmailTemplateKey>(
    request: RelanceEmailRequest<K>,
  ): Promise<{ outboxId: string }>;
};

export type RuntimeJobBacklogRow = {
  jobKind: WorkflowJobKind;
  status: RuntimeJobStatus;
  total: number;
  dueNow: number;
  oldestCreatedAt: string | null;
};

export type RuntimeJobRepository = {
  enqueue(input: EnqueueRuntimeJobInput): Promise<EnqueueRuntimeJobResult>;
  claim(input: ClaimRuntimeJobsInput): Promise<ClaimedRuntimeJob[]>;
  /** `false` si le lease a été perdu entre-temps. */
  complete(input: {
    jobId: string;
    leaseToken: string;
    now: string;
  }): Promise<boolean>;
  fail(input: FailRuntimeJobInput): Promise<FailRuntimeJobOutcome>;
  /**
   * Rend au pool un job claimé mais jamais tenté, sans consommer de tentative.
   * Appelé quand le budget du cron s'épuise au milieu d'un lot.
   */
  release(input: {
    jobId: string;
    leaseToken: string;
    now: string;
  }): Promise<boolean>;
  closeDossier(input: {
    creanceId: string;
    now: string;
  }): Promise<RuntimeCloseDossierOutcome>;
  /**
   * Lecture seule du contexte de rendu. `null` si la créance a disparu entre le
   * scan et le traitement.
   */
  loadJobContext(input: {
    creanceId: string;
  }): Promise<RuntimeJobContext | null>;
  backlog(now: string): Promise<RuntimeJobBacklogRow[]>;
};
