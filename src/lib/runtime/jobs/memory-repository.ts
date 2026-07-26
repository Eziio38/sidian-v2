import { randomUUID } from "node:crypto";

import type {
  EnqueueRuntimeJobInput,
  EnqueueRuntimeJobResult,
  RuntimeJobRecord,
  RuntimeJobRepository,
} from "./types";

export type MemoryRuntimeJobRepository = RuntimeJobRepository & {
  jobs: Map<string, RuntimeJobRecord>;
  byIdempotency: Map<string, string>;
  enqueueCalls: EnqueueRuntimeJobInput[];
  reset: () => void;
};

export function createMemoryRuntimeJobRepository(): MemoryRuntimeJobRepository {
  const jobs = new Map<string, RuntimeJobRecord>();
  const byIdempotency = new Map<string, string>();
  const enqueueCalls: EnqueueRuntimeJobInput[] = [];

  return {
    jobs,
    byIdempotency,
    enqueueCalls,
    reset() {
      jobs.clear();
      byIdempotency.clear();
      enqueueCalls.length = 0;
    },
    async enqueue(input) {
      enqueueCalls.push(input);
      const existingId = byIdempotency.get(input.idempotencyKey);
      if (existingId) {
        const existing = jobs.get(existingId)!;
        return {
          enqueued: false,
          duplicate: true,
          jobId: existing.id,
          status: existing.status,
        } satisfies EnqueueRuntimeJobResult;
      }

      const id = randomUUID();
      const record: RuntimeJobRecord = {
        id,
        prestataireId: input.prestataireId,
        creanceId: input.creanceId,
        dossierSuiviId: input.dossierSuiviId,
        scannerKind: input.scannerKind,
        jobKind: input.jobKind,
        policyVersion: input.policyVersion,
        idempotencyKey: input.idempotencyKey,
        payload: { ...input.payload },
        status: "pending",
        availableAt: input.availableAt ?? input.now,
        createdAt: input.now,
      };
      jobs.set(id, record);
      byIdempotency.set(input.idempotencyKey, id);
      return {
        enqueued: true,
        duplicate: false,
        jobId: id,
        status: "pending",
      };
    },
  };
}
