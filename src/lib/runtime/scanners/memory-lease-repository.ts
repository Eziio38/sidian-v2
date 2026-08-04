import { randomUUID } from "node:crypto";

import type { WorkflowScannerKind } from "../workflow-policy";
import type {
  ClaimScanLeasesInput,
  CompleteScanLeaseInput,
  FailScanLeaseInput,
  ScanLeaseClaim,
  ScanLeaseRepository,
  EnsureScanLeasesInput,
} from "./lease-types";

type LeaseRow = {
  scannerKind: WorkflowScannerKind;
  creanceId: string;
  occurrenceKey: string;
  status: "open" | "claimed" | "completed" | "failed";
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  policyVersion: string;
};

function leaseKey(
  scannerKind: WorkflowScannerKind,
  creanceId: string,
  occurrenceKey: string,
): string {
  return `${scannerKind}::${creanceId}::${occurrenceKey}`;
}

export type MemoryScanLeaseRepository = ScanLeaseRepository & {
  rows: Map<string, LeaseRow>;
  claimCalls: ClaimScanLeasesInput[];
  reset: () => void;
};

export function createMemoryScanLeaseRepository(): MemoryScanLeaseRepository {
  const rows = new Map<string, LeaseRow>();
  const claimCalls: ClaimScanLeasesInput[] = [];

  return {
    rows,
    claimCalls,
    reset() {
      rows.clear();
      claimCalls.length = 0;
    },
    async ensure(input: EnsureScanLeasesInput) {
      let inserted = 0;
      for (const item of input.items) {
        const key = leaseKey(
          input.scannerKind,
          item.creanceId,
          item.occurrenceKey,
        );
        if (rows.has(key)) continue;
        rows.set(key, {
          scannerKind: input.scannerKind,
          creanceId: item.creanceId,
          occurrenceKey: item.occurrenceKey,
          status: "open",
          leaseToken: null,
          leaseExpiresAt: null,
          policyVersion: input.policyVersion,
        });
        inserted += 1;
      }
      return inserted;
    },
    async claim(input: ClaimScanLeasesInput) {
      claimCalls.push(input);
      const nowMs = Date.parse(input.now);
      const wanted = new Set(
        input.items.map((i) =>
          leaseKey(input.scannerKind, i.creanceId, i.occurrenceKey),
        ),
      );
      const claimable = [...rows.values()]
        .filter((row) => wanted.has(leaseKey(row.scannerKind, row.creanceId, row.occurrenceKey)))
        .filter((row) => {
          if (row.status === "completed") return false;
          if (row.status === "open" || row.status === "failed") return true;
          if (row.status === "claimed" && row.leaseExpiresAt) {
            return Date.parse(row.leaseExpiresAt) <= nowMs;
          }
          return false;
        })
        .sort((a, b) => a.creanceId.localeCompare(b.creanceId))
        .slice(0, input.batchSize);

      const token = randomUUID();
      const expiresAt = new Date(
        nowMs + input.leaseSeconds * 1000,
      ).toISOString();
      const claimed: ScanLeaseClaim[] = [];

      for (const row of claimable) {
        row.status = "claimed";
        row.leaseToken = token;
        row.leaseExpiresAt = expiresAt;
        claimed.push({
          creanceId: row.creanceId,
          occurrenceKey: row.occurrenceKey,
          leaseToken: token,
          leaseExpiresAt: expiresAt,
        });
      }
      return claimed;
    },
    async complete(input: CompleteScanLeaseInput) {
      const key = leaseKey(
        input.scannerKind,
        input.creanceId,
        input.occurrenceKey,
      );
      const row = rows.get(key);
      if (!row) return false;
      if (row.status !== "claimed") return false;
      if (row.leaseToken !== input.leaseToken) return false;
      if (
        !row.leaseExpiresAt ||
        Date.parse(row.leaseExpiresAt) <= Date.parse(input.now)
      ) {
        return false;
      }
      row.status = "completed";
      row.leaseToken = null;
      row.leaseExpiresAt = null;
      return true;
    },
    async fail(input: FailScanLeaseInput) {
      const key = leaseKey(
        input.scannerKind,
        input.creanceId,
        input.occurrenceKey,
      );
      const row = rows.get(key);
      if (!row) return false;
      if (row.status !== "claimed") return false;
      if (row.leaseToken !== input.leaseToken) return false;
      if (
        !row.leaseExpiresAt ||
        Date.parse(row.leaseExpiresAt) <= Date.parse(input.now)
      ) {
        return false;
      }
      row.status = "failed";
      row.leaseToken = null;
      row.leaseExpiresAt = null;
      return true;
    },
  };
}
