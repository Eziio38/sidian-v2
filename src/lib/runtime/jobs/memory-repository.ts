import { randomUUID } from "node:crypto";

import type {
  ClaimedRuntimeJob,
  EnqueueRuntimeJobInput,
  EnqueueRuntimeJobResult,
  RuntimeCloseDossierOutcome,
  RuntimeJobContext,
  RuntimeJobRecord,
  RuntimeJobRepository,
} from "./types";

/** État interne d'un job en mémoire — mime les colonnes de `runtime_job`. */
type MemoryJob = RuntimeJobRecord & {
  attemptCount: number;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  lastErrorCode: string | null;
};

export type MemoryRuntimeJobRepository = RuntimeJobRepository & {
  jobs: Map<string, MemoryJob>;
  byIdempotency: Map<string, string>;
  enqueueCalls: EnqueueRuntimeJobInput[];
  /** Résultat que `closeDossier` doit renvoyer, par créance. */
  closeDossierOutcomes: Map<string, RuntimeCloseDossierOutcome>;
  closeDossierCalls: string[];
  /** Contexte renvoyé par `loadJobContext`, par créance. */
  jobContexts: Map<string, RuntimeJobContext>;
  loadJobContextCalls: string[];
  reset: () => void;
};

/** Contexte de test cohérent : le tenant vient toujours de la créance. */
export function buildTestRuntimeJobContext(
  overrides: Partial<RuntimeJobContext> & { creanceId: string },
): RuntimeJobContext {
  return {
    prestataireId: "prestataire-1",
    prestataireNom: "Atelier Dupont",
    clientPayeurId: "client-1",
    clientNom: "Société Martin",
    clientEmail: "client@exemple.test",
    montantCents: 125_000,
    devise: "EUR",
    dateEcheance: "2026-08-03",
    etat: "OUVERTE",
    paymentLinkActive: false,
    paymentLinkId: null,
    // Défaut du produit : tout est activé tant que rien n'est décoché.
    notifyReminderBeforeDue: true,
    notifyPaymentFailed: true,
    // Jamais reconstituable côté serveur — cf. runtime_load_job_context.
    paymentLinkUrl: null,
    ...overrides,
  };
}

export function createMemoryRuntimeJobRepository(): MemoryRuntimeJobRepository {
  const jobs = new Map<string, MemoryJob>();
  const byIdempotency = new Map<string, string>();
  const enqueueCalls: EnqueueRuntimeJobInput[] = [];
  const closeDossierOutcomes = new Map<string, RuntimeCloseDossierOutcome>();
  const closeDossierCalls: string[] = [];
  const jobContexts = new Map<string, RuntimeJobContext>();
  const loadJobContextCalls: string[] = [];

  return {
    jobs,
    byIdempotency,
    enqueueCalls,
    closeDossierOutcomes,
    closeDossierCalls,
    jobContexts,
    loadJobContextCalls,
    reset() {
      jobs.clear();
      byIdempotency.clear();
      enqueueCalls.length = 0;
      closeDossierOutcomes.clear();
      closeDossierCalls.length = 0;
      jobContexts.clear();
      loadJobContextCalls.length = 0;
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
      const record: MemoryJob = {
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
        attemptCount: 0,
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
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

    async claim(input) {
      if (input.jobKinds.length === 0) return [];
      const kinds = new Set(input.jobKinds);
      const nowMs = Date.parse(input.now);
      const claimed: ClaimedRuntimeJob[] = [];

      const candidates = [...jobs.values()]
        .filter((job) => {
          if (!kinds.has(job.jobKind)) return false;
          if (Date.parse(job.availableAt) > nowMs) return false;
          // Miroir de la borne SQL : la contrainte de table plafonne à 32 et
          // le claim incrémente, donc au-delà le job cesse d'être éligible.
          if (job.attemptCount >= 32) return false;
          if (job.status === "pending" || job.status === "failed_retryable") {
            return true;
          }
          // Reprise après crash : un lease expiré redevient claimable.
          return (
            job.status === "claimed" &&
            job.leaseExpiresAt !== null &&
            Date.parse(job.leaseExpiresAt) <= nowMs
          );
        })
        .sort(
          (a, b) =>
            Date.parse(a.availableAt) - Date.parse(b.availableAt) ||
            Date.parse(a.createdAt) - Date.parse(b.createdAt),
        )
        .slice(0, input.batchSize);

      for (const job of candidates) {
        job.status = "claimed";
        job.attemptCount += 1;
        job.leaseToken = randomUUID();
        job.leaseExpiresAt = new Date(
          nowMs + input.leaseSeconds * 1000,
        ).toISOString();
        job.lastErrorCode = null;
        claimed.push({ ...job, leaseToken: job.leaseToken, leaseExpiresAt: job.leaseExpiresAt });
      }
      return claimed;
    },

    async complete(input) {
      const job = jobs.get(input.jobId);
      if (!job) return false;
      const nowMs = Date.parse(input.now);
      if (
        job.status !== "claimed" ||
        job.leaseToken !== input.leaseToken ||
        job.leaseExpiresAt === null ||
        Date.parse(job.leaseExpiresAt) <= nowMs
      ) {
        return false;
      }
      job.status = "completed";
      job.leaseToken = null;
      job.leaseExpiresAt = null;
      job.lastErrorCode = null;
      return true;
    },

    async release(input) {
      const job = jobs.get(input.jobId);
      const nowMs = Date.parse(input.now);
      if (
        !job ||
        job.status !== "claimed" ||
        job.leaseToken !== input.leaseToken ||
        job.leaseExpiresAt === null ||
        Date.parse(job.leaseExpiresAt) <= nowMs
      ) {
        return false;
      }
      job.status = "pending";
      job.leaseToken = null;
      job.leaseExpiresAt = null;
      job.attemptCount = Math.max(0, job.attemptCount - 1);
      job.lastErrorCode = null;
      return true;
    },

    async fail(input) {
      const job = jobs.get(input.jobId);
      const nowMs = Date.parse(input.now);
      if (
        !job ||
        job.status !== "claimed" ||
        job.leaseToken !== input.leaseToken ||
        job.leaseExpiresAt === null ||
        Date.parse(job.leaseExpiresAt) <= nowMs
      ) {
        return "lease_lost";
      }

      const maxAttempts = input.maxAttempts ?? 5;
      const base = input.backoffBaseSeconds ?? 60;
      job.leaseToken = null;
      job.leaseExpiresAt = null;
      job.lastErrorCode = input.errorCode;

      if (!input.retryable || job.attemptCount >= maxAttempts) {
        job.status = "failed_terminal";
        return "failed_terminal";
      }

      const delay = Math.min(
        base * Math.pow(2, Math.max(0, job.attemptCount - 1)),
        3600,
      );
      job.status = "failed_retryable";
      job.availableAt = new Date(nowMs + delay * 1000).toISOString();
      return "failed_retryable";
    },

    async closeDossier(input) {
      closeDossierCalls.push(input.creanceId);
      return closeDossierOutcomes.get(input.creanceId) ?? "closed";
    },

    async loadJobContext(input) {
      loadJobContextCalls.push(input.creanceId);
      // Absence = créance disparue entre le scan et le traitement, comme en SQL.
      return jobContexts.get(input.creanceId) ?? null;
    },

    async backlog() {
      const byKey = new Map<string, { total: number; dueNow: number }>();
      for (const job of jobs.values()) {
        if (
          job.status !== "pending" &&
          job.status !== "claimed" &&
          job.status !== "failed_retryable"
        ) {
          continue;
        }
        const key = `${job.jobKind}|${job.status}`;
        const entry = byKey.get(key) ?? { total: 0, dueNow: 0 };
        entry.total += 1;
        byKey.set(key, entry);
      }
      return [...byKey.entries()].map(([key, value]) => {
        const [jobKind, status] = key.split("|");
        return {
          jobKind: jobKind as MemoryJob["jobKind"],
          status: status as MemoryJob["status"],
          total: value.total,
          dueNow: value.dueNow,
          oldestCreatedAt: null,
        };
      });
    },
  };
}
