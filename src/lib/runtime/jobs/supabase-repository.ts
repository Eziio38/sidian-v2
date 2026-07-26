import { RuntimeError } from "../errors";
import type {
  EnqueueRuntimeJobInput,
  EnqueueRuntimeJobResult,
  RuntimeJobRepository,
  RuntimeJobStatus,
} from "./types";

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
  };
}
