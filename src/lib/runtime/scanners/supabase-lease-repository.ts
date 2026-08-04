import { RuntimeError } from "../errors";
import type { WorkflowScannerKind } from "../workflow-policy";
import type {
  ClaimScanLeasesInput,
  CompleteScanLeaseInput,
  EnsureScanLeasesInput,
  FailScanLeaseInput,
  ScanLeaseClaim,
  ScanLeaseRepository,
} from "./lease-types";

type RpcResult<T> = {
  data: T | null;
  error: { message?: string } | null;
};

export type RuntimeLeaseRpcClient = {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult<unknown>>;
};

function requireOk(error: { message?: string } | null, code: string): void {
  if (error) {
    throw new RuntimeError(code, error.message ?? code);
  }
}

export function createSupabaseScanLeaseRepository(
  client: RuntimeLeaseRpcClient,
): ScanLeaseRepository {
  return {
    async ensure(input: EnsureScanLeasesInput) {
      const { data, error } = await client.rpc("ensure_runtime_scan_leases", {
        p_scanner_kind: input.scannerKind,
        p_creance_ids: input.items.map((i) => i.creanceId),
        p_occurrence_keys: input.items.map((i) => i.occurrenceKey),
        p_policy_version: input.policyVersion,
      });
      requireOk(error, "runtime_scan_lease_ensure_failed");
      return typeof data === "number" ? data : 0;
    },

    async claim(input: ClaimScanLeasesInput) {
      const { data, error } = await client.rpc("claim_runtime_scan_leases", {
        p_scanner_kind: input.scannerKind,
        p_creance_ids: input.items.map((i) => i.creanceId),
        p_occurrence_keys: input.items.map((i) => i.occurrenceKey),
        p_now: input.now,
        p_lease_seconds: input.leaseSeconds,
        p_batch_size: input.batchSize,
      });
      requireOk(error, "runtime_scan_lease_claim_failed");
      const rows = Array.isArray(data) ? data : [];
      return rows.map((row): ScanLeaseClaim => {
        const r = row as Record<string, unknown>;
        return {
          creanceId: String(r.creance_id),
          occurrenceKey: String(r.occurrence_key),
          leaseToken: String(r.lease_token),
          leaseExpiresAt: String(r.lease_expires_at),
        };
      });
    },

    async complete(input: CompleteScanLeaseInput) {
      const { data, error } = await client.rpc("complete_runtime_scan_lease", {
        p_scanner_kind: input.scannerKind as WorkflowScannerKind,
        p_creance_id: input.creanceId,
        p_occurrence_key: input.occurrenceKey,
        p_lease_token: input.leaseToken,
        p_now: input.now,
      });
      requireOk(error, "runtime_scan_lease_complete_failed");
      return data === true;
    },

    async fail(input: FailScanLeaseInput) {
      const { data, error } = await client.rpc("fail_runtime_scan_lease", {
        p_scanner_kind: input.scannerKind,
        p_creance_id: input.creanceId,
        p_occurrence_key: input.occurrenceKey,
        p_lease_token: input.leaseToken,
        p_error_code: input.errorCode ?? null,
        p_now: input.now,
      });
      requireOk(error, "runtime_scan_lease_fail_failed");
      return data === true;
    },
  };
}
