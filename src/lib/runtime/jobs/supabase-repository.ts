import type { WorkflowJobKind, WorkflowScannerKind } from "../workflow-policy";
import { RuntimeError } from "../errors";
import type {
  ClaimedRuntimeJob,
  ClaimRuntimeJobsInput,
  EnqueueRuntimeJobInput,
  EnqueueRuntimeJobResult,
  FailRuntimeJobInput,
  FailRuntimeJobOutcome,
  RuntimeCloseDossierOutcome,
  RuntimeJobBacklogRow,
  RuntimeJobContext,
  RuntimeJobRepository,
  RuntimeJobStatus,
} from "./types";

/** Ligne `runtime_job` telle que renvoyée par `claim_runtime_jobs`. */
type RuntimeJobRow = {
  id: string;
  prestataire_id: string;
  creance_id: string;
  dossier_suivi_id: string | null;
  scanner_kind: string;
  job_kind: string;
  policy_version: string;
  idempotency_key: string;
  payload: Record<string, unknown> | null;
  status: string;
  attempt_count: number;
  lease_token: string | null;
  lease_expires_at: string | null;
  available_at: string;
  created_at: string;
};

function toClaimedJob(row: RuntimeJobRow): ClaimedRuntimeJob {
  return {
    id: row.id,
    prestataireId: row.prestataire_id,
    creanceId: row.creance_id,
    dossierSuiviId: row.dossier_suivi_id,
    scannerKind: row.scanner_kind as WorkflowScannerKind,
    jobKind: row.job_kind as WorkflowJobKind,
    policyVersion: row.policy_version,
    idempotencyKey: row.idempotency_key,
    payload: row.payload ?? {},
    status: row.status as RuntimeJobStatus,
    availableAt: row.available_at,
    createdAt: row.created_at,
    attemptCount: row.attempt_count,
    // `claim_runtime_jobs` pose toujours ces deux colonnes sur les lignes
    // qu'elle renvoie ; le repli défensif évite un cast silencieux.
    leaseToken: row.lease_token ?? "",
    leaseExpiresAt: row.lease_expires_at ?? "",
  };
}

type RpcResult<T> = {
  data: T | null;
  error: { message?: string } | null;
};

export type RuntimeJobRpcClient = {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult<unknown>>;
};

export function createSupabaseRuntimeJobRepository(
  client: RuntimeJobRpcClient,
): RuntimeJobRepository {
  return {
    async enqueue(input: EnqueueRuntimeJobInput) {
      const { data, error } = await client.rpc("enqueue_runtime_job", {
        p_prestataire_id: input.prestataireId,
        p_creance_id: input.creanceId,
        p_dossier_suivi_id: input.dossierSuiviId,
        p_scanner_kind: input.scannerKind,
        p_job_kind: input.jobKind,
        p_policy_version: input.policyVersion,
        p_idempotency_key: input.idempotencyKey,
        p_payload: input.payload,
        p_available_at: input.availableAt ?? input.now,
        p_now: input.now,
      });
      if (error) {
        throw new RuntimeError(
          "runtime_job_enqueue_failed",
          error.message ?? "runtime_job_enqueue_failed",
        );
      }
      const row = (data ?? {}) as Record<string, unknown>;
      return {
        enqueued: row.enqueued === true,
        duplicate: row.duplicate === true,
        jobId: String(row.job_id),
        status: String(row.status) as RuntimeJobStatus,
      } satisfies EnqueueRuntimeJobResult;
    },

    async claim(input: ClaimRuntimeJobsInput) {
      // Aucun job kind demandé : rien à claimer. Ne pas passer `null` à la RPC,
      // qui l'interprète comme « tous les types » — un consommateur claimerait
      // alors des jobs qu'il ne sait pas traiter.
      if (input.jobKinds.length === 0) return [];

      const { data, error } = await client.rpc("claim_runtime_jobs", {
        p_now: input.now,
        p_lease_seconds: input.leaseSeconds,
        p_batch_size: input.batchSize,
        p_job_kinds: [...input.jobKinds],
      });
      if (error) {
        throw new RuntimeError(
          "runtime_job_claim_failed",
          error.message ?? "runtime_job_claim_failed",
        );
      }
      const rows = (data ?? []) as RuntimeJobRow[];
      return rows.map(toClaimedJob);
    },

    async complete(input) {
      const { data, error } = await client.rpc("complete_runtime_job", {
        p_job_id: input.jobId,
        p_lease_token: input.leaseToken,
        p_now: input.now,
      });
      if (error) {
        throw new RuntimeError(
          "runtime_job_complete_failed",
          error.message ?? "runtime_job_complete_failed",
        );
      }
      return data === true;
    },

    async release(input) {
      const { data, error } = await client.rpc("release_runtime_job", {
        p_job_id: input.jobId,
        p_lease_token: input.leaseToken,
        p_now: input.now,
      });
      if (error) {
        throw new RuntimeError(
          "runtime_job_release_failed",
          error.message ?? "runtime_job_release_failed",
        );
      }
      return data === true;
    },

    async fail(input: FailRuntimeJobInput) {
      const { data, error } = await client.rpc("fail_runtime_job", {
        p_job_id: input.jobId,
        p_lease_token: input.leaseToken,
        p_error_code: input.errorCode,
        p_retryable: input.retryable,
        p_max_attempts: input.maxAttempts ?? null,
        p_backoff_base_seconds: input.backoffBaseSeconds ?? null,
        p_now: input.now,
      });
      if (error) {
        throw new RuntimeError(
          "runtime_job_fail_failed",
          error.message ?? "runtime_job_fail_failed",
        );
      }
      return String(data) as FailRuntimeJobOutcome;
    },

    async closeDossier(input) {
      const { data, error } = await client.rpc("runtime_close_dossier", {
        p_creance_id: input.creanceId,
        p_now: input.now,
      });
      if (error) {
        throw new RuntimeError(
          "runtime_close_dossier_failed",
          error.message ?? "runtime_close_dossier_failed",
        );
      }
      return String(data) as RuntimeCloseDossierOutcome;
    },

    async loadJobContext(input) {
      const { data, error } = await client.rpc("runtime_load_job_context", {
        p_creance_id: input.creanceId,
      });
      if (error) {
        throw new RuntimeError(
          "runtime_load_job_context_failed",
          error.message ?? "runtime_load_job_context_failed",
        );
      }
      if (!data) return null;
      const row = data as Record<string, unknown>;
      return {
        creanceId: String(row.creance_id),
        prestataireId: String(row.prestataire_id),
        prestataireNom: String(row.prestataire_nom ?? ""),
        clientPayeurId: String(row.client_payeur_id),
        clientNom: String(row.client_nom ?? ""),
        clientEmail: String(row.client_email ?? ""),
        montantCents: Number(row.montant_cents ?? 0),
        devise: String(row.devise ?? ""),
        dateEcheance: String(row.date_echeance ?? ""),
        etat: String(row.etat ?? ""),
        paymentLinkActive: row.payment_link_active === true,
        // Absent (ancienne signature de la RPC) ⇒ activé, comme le SQL.
        notifyReminderBeforeDue: row.notify_reminder_before_due !== false,
        notifyPaymentFailed: row.notify_payment_failed !== false,
        paymentLinkId: (row.payment_link_id as string | null) ?? null,
        // Toujours null côté SQL : le jeton brut n'est pas stocké. Ne jamais
        // le fabriquer ici — un lien inventé ne résoudrait rien.
        paymentLinkUrl: (row.payment_link_url as string | null) ?? null,
      } satisfies RuntimeJobContext;
    },

    async backlog(now: string) {
      const { data, error } = await client.rpc("runtime_job_backlog", {
        p_now: now,
      });
      if (error) {
        throw new RuntimeError(
          "runtime_job_backlog_failed",
          error.message ?? "runtime_job_backlog_failed",
        );
      }
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        jobKind: String(row.job_kind) as WorkflowJobKind,
        status: String(row.status) as RuntimeJobStatus,
        total: Number(row.total ?? 0),
        dueNow: Number(row.due_now ?? 0),
        oldestCreatedAt: (row.oldest_created_at as string | null) ?? null,
      })) satisfies RuntimeJobBacklogRow[];
    },
  };
}
