/**
 * Consommateur de `runtime_job` — le maillon qui manquait entre les scanners
 * et les effets métier.
 *
 * Les scanners persistent des *intentions* ; ce dispatcher les transforme en
 * effets. Deux règles structurent tout le reste :
 *
 * 1. **On ne claime que ce que l'on sait traiter.** Un type de job sans
 *    handler n'est jamais claimé : il reste `pending`, visible dans le
 *    backlog, sans consommer de tentative ni finir en échec terminal. Le
 *    câblage manquant est un fait observable, jamais une perte silencieuse.
 *
 * 2. **Aucun effet n'est simulé.** Un handler absent n'invente pas un succès.
 *    Les types encore non câblés sont déclarés ici explicitement, avec la
 *    raison, et se retrouvent tels quels dans le rapport du cron.
 */

import type { WorkflowJobKind } from "../workflow-policy";
import type {
  ClaimedRuntimeJob,
  RelanceMailer,
  RuntimeJobRepository,
} from "./types";
import { RELANCE_JOB_HANDLERS } from "./handlers/relance";

export const RUNTIME_JOB_OUTCOMES = [
  "completed",
  "retryable",
  "terminal",
  "lease_lost",
  "released",
  "unhandled",
] as const;

export type RuntimeJobOutcome = (typeof RUNTIME_JOB_OUTCOMES)[number];

/**
 * Résultat d'un handler.
 * `retryable: false` signifie « inutile de réessayer », pas « ignoré ».
 */
export type RuntimeJobHandlerResult =
  | { status: "completed"; detail?: string }
  | { status: "failed"; errorCode: string; retryable: boolean };

export type RuntimeJobHandlerContext = {
  now: string;
  repository: RuntimeJobRepository;
  /**
   * Canal email injecté par l'appelant (cron). Absent = relances non câblées :
   * les handlers concernés échouent explicitement au lieu de feindre l'envoi.
   */
  mailer?: RelanceMailer;
};

export type RuntimeJobHandler = (
  job: ClaimedRuntimeJob,
  context: RuntimeJobHandlerContext,
) => Promise<RuntimeJobHandlerResult>;

/**
 * Types de jobs délibérément non câblés, avec la raison exacte.
 *
 * Ce ne sont pas des oublis : chacun dépend d'un arbitrage produit ou d'un
 * fournisseur externe non encore configuré. Les déclarer ici les rend
 * visibles dans le rapport du cron plutôt que silencieux dans la base.
 *
 * [CORRECTION — 3 août 2026]
 * Les quatre types de relance y figuraient au motif que « la cadence et la
 * copie ne sont pas arrêtées ». C'était faux : la cadence est versionnée dans
 * `WORKFLOW_POLICY` (prévention J-5, échéance J+0, silence après délai de
 * grâce, retries « none ») et les scanners l'appliquent déjà ; les huit
 * gabarits français existent dans `email/templates/registry.ts`. Il ne
 * manquait que le câblage — il est désormais fait.
 */
export const UNWIRED_JOB_KINDS: Readonly<Record<string, string>> = {
  autopay_intent:
    "prélèvement automatique bloqué en amont du câblage : le plafond de règle n'est pas prêt côté produit (AUTO_DEBIT_REGLE_CEILING_PRODUCT_READY=false, src/lib/runtime/payments/constants.ts). Aucun handler ne doit créer de tentative tant que ce plafond n'est pas arbitré.",
};

/**
 * Clôture de dossier — le seul effet entièrement interne.
 *
 * Il ne dépend d'aucun fournisseur externe et d'aucun arbitrage produit : la
 * règle de transition est déjà fixée en base
 * (`is_dossier_suivi_transition_allowed`) et en TypeScript
 * (`allowedFollowUpTargets`). Le handler ne fait que la déclencher.
 */
export const closeDossierHandler: RuntimeJobHandler = async (job, context) => {
  const outcome = await context.repository.closeDossier({
    creanceId: job.creanceId,
    now: context.now,
  });

  switch (outcome) {
    case "closed":
    case "already_closed":
      // Rejouer sur un dossier déjà clos est un succès : le job est idempotent.
      return { status: "completed", detail: outcome };
    case "creance_not_found":
      // La créance a disparu : réessayer ne la fera pas revenir.
      return {
        status: "failed",
        errorCode: "creance_not_found",
        retryable: false,
      };
    case "creance_not_terminal":
      // La créance est repassée à un état actif entre le scan et le traitement.
      // Le job n'a plus lieu d'être ; le prochain scan en produira un nouveau.
      return {
        status: "failed",
        errorCode: "creance_not_terminal",
        retryable: false,
      };
    case "transition_forbidden":
      return {
        status: "failed",
        errorCode: "transition_forbidden",
        retryable: false,
      };
    default:
      return {
        status: "failed",
        errorCode: "unexpected_outcome",
        retryable: false,
      };
  }
};

export const DEFAULT_RUNTIME_JOB_HANDLERS: Partial<
  Record<WorkflowJobKind, RuntimeJobHandler>
> = {
  closure_close_dossier: closeDossierHandler,
  ...RELANCE_JOB_HANDLERS,
};

export type RuntimeJobItemResult = {
  jobId: string;
  jobKind: WorkflowJobKind;
  outcome: RuntimeJobOutcome;
  errorCode?: string;
};

export type RuntimeJobDispatchResult = {
  claimed: number;
  completed: number;
  retryable: number;
  terminal: number;
  leaseLost: number;
  /** Jobs claimés puis rendus au pool faute de budget — aucune tentative consommée. */
  released: number;
  /** Types présents en file mais sans handler — jamais claimés. */
  unwired: Array<{ jobKind: string; reason: string; pending: number }>;
  items: RuntimeJobItemResult[];
  durationMs: number;
  ranAt: string;
};

export type DispatchRuntimeJobsInput = {
  repository: RuntimeJobRepository;
  handlers?: Partial<Record<WorkflowJobKind, RuntimeJobHandler>>;
  /** Canal email des relances. Absent = aucun envoi, échec typé côté handler. */
  mailer?: RelanceMailer;
  batchSize?: number;
  leaseSeconds?: number;
  maxAttempts?: number;
  backoffBaseSeconds?: number;
  /** Horloge injectée — jamais `Date.now()` implicite dans les tests. */
  now?: () => Date;
  /** Interrompt la boucle quand le budget du cron est épuisé. */
  isDeadlineExpired?: () => boolean;
};

export const DEFAULT_RUNTIME_JOB_BATCH_SIZE = 25;
export const DEFAULT_RUNTIME_JOB_LEASE_SECONDS = 120;
export const DEFAULT_RUNTIME_JOB_MAX_ATTEMPTS = 5;
export const DEFAULT_RUNTIME_JOB_BACKOFF_BASE_SECONDS = 60;

export async function dispatchRuntimeJobs(
  input: DispatchRuntimeJobsInput,
): Promise<RuntimeJobDispatchResult> {
  const startedMs = Date.now();
  const clock = input.now ?? (() => new Date());
  const ranAt = clock().toISOString();
  const handlers = input.handlers ?? DEFAULT_RUNTIME_JOB_HANDLERS;

  const handledKinds = Object.keys(handlers).filter(
    (kind) => typeof handlers[kind as WorkflowJobKind] === "function",
  ) as WorkflowJobKind[];

  const result: RuntimeJobDispatchResult = {
    claimed: 0,
    completed: 0,
    retryable: 0,
    terminal: 0,
    leaseLost: 0,
    released: 0,
    unwired: [],
    items: [],
    durationMs: 0,
    ranAt,
  };

  // Backlog d'abord : il documente ce qui s'accumule sans consommateur.
  try {
    const backlog = await input.repository.backlog(ranAt);
    const pendingByKind = new Map<string, number>();
    for (const row of backlog) {
      if (handledKinds.includes(row.jobKind)) continue;
      pendingByKind.set(
        row.jobKind,
        (pendingByKind.get(row.jobKind) ?? 0) + row.total,
      );
    }
    for (const [jobKind, pending] of pendingByKind) {
      result.unwired.push({
        jobKind,
        reason: UNWIRED_JOB_KINDS[jobKind] ?? "aucun handler enregistré",
        pending,
      });
    }
  } catch {
    // Le backlog est de l'observabilité : son échec ne doit pas empêcher le
    // traitement des jobs réellement consommables.
  }

  if (handledKinds.length === 0) {
    result.durationMs = Math.max(0, Date.now() - startedMs);
    return result;
  }

  const claimed = await input.repository.claim({
    now: ranAt,
    leaseSeconds: input.leaseSeconds ?? DEFAULT_RUNTIME_JOB_LEASE_SECONDS,
    batchSize: input.batchSize ?? DEFAULT_RUNTIME_JOB_BATCH_SIZE,
    jobKinds: handledKinds,
  });
  result.claimed = claimed.length;

  for (const [index, job] of claimed.entries()) {
    if (input.isDeadlineExpired?.()) {
      /*
        Budget épuisé. Les jobs restants du lot ont été claimés mais jamais
        tentés : les laisser expirer les ferait re-claimer plus tard, et chaque
        reprise consomme une tentative. Un job systématiquement pris en fin de
        lot épuisait ainsi son quota sans avoir jamais été exécuté, jusqu'à
        buter sur la contrainte `attempt_count <= 32` — ce qui faisait échouer
        le claim de *tout* le lot, pas seulement le sien.

        On rend donc explicitement les tentatives non consommées.
      */
      for (const pending of claimed.slice(index)) {
        try {
          const released = await input.repository.release({
            jobId: pending.id,
            leaseToken: pending.leaseToken,
            now: clock().toISOString(),
          });
          result.items.push({
            jobId: pending.id,
            jobKind: pending.jobKind,
            outcome: released ? "released" : "lease_lost",
          });
          if (released) result.released += 1;
          else result.leaseLost += 1;
        } catch {
          // Le relâchement est une optimisation : son échec ne doit pas faire
          // échouer le drain. Le lease expirera, au prix d'une tentative.
          result.leaseLost += 1;
        }
      }
      break;
    }

    const handler = handlers[job.jobKind];
    if (!handler) {
      // Ne devrait pas arriver : on n'a claimé que des types câblés.
      result.items.push({
        jobId: job.id,
        jobKind: job.jobKind,
        outcome: "unhandled",
      });
      continue;
    }

    const jobNow = clock().toISOString();
    let handlerResult: RuntimeJobHandlerResult;
    try {
      handlerResult = await handler(job, {
        now: jobNow,
        repository: input.repository,
        mailer: input.mailer,
      });
    } catch (error) {
      // Une exception inattendue est rejouable : c'est probablement passager.
      handlerResult = {
        status: "failed",
        errorCode:
          error instanceof Error
            ? error.message.slice(0, 80)
            : "handler_threw",
        retryable: true,
      };
    }

    if (handlerResult.status === "completed") {
      const acknowledged = await input.repository.complete({
        jobId: job.id,
        leaseToken: job.leaseToken,
        now: clock().toISOString(),
      });
      if (acknowledged) {
        result.completed += 1;
        result.items.push({
          jobId: job.id,
          jobKind: job.jobKind,
          outcome: "completed",
        });
      } else {
        // L'effet a eu lieu mais le lease était perdu : un autre worker a
        // repris le job. Les handlers doivent donc rester idempotents.
        result.leaseLost += 1;
        result.items.push({
          jobId: job.id,
          jobKind: job.jobKind,
          outcome: "lease_lost",
        });
      }
      continue;
    }

    const failure = await input.repository.fail({
      jobId: job.id,
      leaseToken: job.leaseToken,
      errorCode: handlerResult.errorCode,
      retryable: handlerResult.retryable,
      maxAttempts: input.maxAttempts ?? DEFAULT_RUNTIME_JOB_MAX_ATTEMPTS,
      backoffBaseSeconds:
        input.backoffBaseSeconds ?? DEFAULT_RUNTIME_JOB_BACKOFF_BASE_SECONDS,
      now: clock().toISOString(),
    });

    if (failure === "failed_retryable") result.retryable += 1;
    else if (failure === "failed_terminal") result.terminal += 1;
    else result.leaseLost += 1;

    result.items.push({
      jobId: job.id,
      jobKind: job.jobKind,
      outcome:
        failure === "failed_retryable"
          ? "retryable"
          : failure === "failed_terminal"
            ? "terminal"
            : "lease_lost",
      errorCode: handlerResult.errorCode,
    });
  }

  result.durationMs = Math.max(0, Date.now() - startedMs);
  return result;
}
