import { randomUUID } from "node:crypto";

import { AUTOMATIC_EXECUTION_GUARD_VERSION } from "./constants";
import { PaymentRuntimeError } from "./errors";
import type {
  ClaimPaymentJobResult,
  CompletePaymentJobInput,
  EnqueuePaymentJobInput,
  PaymentAttemptRepository,
  PaymentJobRepository,
  TentativeClaimResult,
  CompleteTentativeInput,
  FailTentativeInput,
} from "./repository";
import type {
  AutomaticPaymentChecklistInput,
  PaymentJob,
  PaymentJobStatus,
} from "./types";

function nowIso(now?: string): string {
  return now ?? new Date().toISOString();
}

export function createMemoryPaymentJobRepository(): PaymentJobRepository {
  const byId = new Map<string, PaymentJob>();
  const byKey = new Map<string, string>();

  function clone(job: PaymentJob): PaymentJob {
    return structuredClone(job);
  }

  async function enqueue(input: EnqueuePaymentJobInput): Promise<PaymentJob> {
    const existingId = byKey.get(input.idempotencyKey);
    if (existingId) {
      const existing = byId.get(existingId);
      if (!existing) throw new Error("payment_job_index_corrupt");
      if (
        existing.creanceId !== input.creanceId ||
        existing.amountCents !== input.amountCents ||
        existing.prestataireId !== input.prestataireId
      ) {
        throw new PaymentRuntimeError({
          code: "DUPLICATE_REQUEST",
          category: "business",
          message: "payment_job_idempotency_conflict",
        });
      }
      return clone(existing);
    }

    const ts = nowIso(input.now);
    const job: PaymentJob = {
      id: randomUUID(),
      prestataireId: input.prestataireId,
      creanceId: input.creanceId,
      amountCents: input.amountCents,
      currency: input.currency,
      source: input.source,
      idempotencyKey: input.idempotencyKey,
      status: "pending",
      leaseToken: null,
      leaseExpiresAt: null,
      tentativePaiementId: null,
      stripePaymentIntentId: null,
      failureCode: null,
      correlationId: input.correlationId ?? null,
      attemptCount: 0,
      createdAt: ts,
      updatedAt: ts,
    };
    byId.set(job.id, job);
    byKey.set(job.idempotencyKey, job.id);
    return clone(job);
  }

  function tryClaim(
    job: PaymentJob,
    leaseSeconds: number,
    now: string,
  ): ClaimPaymentJobResult {
    if (
      job.status === "succeeded_pending_webhook" ||
      job.status === "failed_terminal"
    ) {
      return { status: "already_terminal", job: clone(job) };
    }
    if (
      job.status === "claimed" &&
      job.leaseExpiresAt &&
      job.leaseExpiresAt > now
    ) {
      return { status: "in_progress", job: clone(job) };
    }

    const leaseToken = randomUUID();
    const expires = new Date(now);
    expires.setUTCSeconds(expires.getUTCSeconds() + leaseSeconds);
    job.status = "claimed";
    job.leaseToken = leaseToken;
    job.leaseExpiresAt = expires.toISOString();
    job.attemptCount += 1;
    job.updatedAt = now;
    return { status: "claimed", job: clone(job), leaseToken };
  }

  return {
    enqueue,
    async claimNext({ leaseSeconds, now }) {
      const ts = nowIso(now);
      const candidate = [...byId.values()]
        .filter(
          (j) =>
            j.status === "pending" ||
            j.status === "failed_retryable" ||
            j.status === "unknown" ||
            (j.status === "claimed" &&
              j.leaseExpiresAt !== null &&
              j.leaseExpiresAt <= ts),
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!candidate) return { status: "not_found" };
      return tryClaim(candidate, leaseSeconds, ts);
    },
    async claimById({ jobId, leaseSeconds, now }) {
      const job = byId.get(jobId);
      if (!job) return { status: "not_found" };
      return tryClaim(job, leaseSeconds, nowIso(now));
    },
    async complete(input: CompletePaymentJobInput) {
      const job = byId.get(input.jobId);
      if (!job) {
        throw new PaymentRuntimeError({
          code: "JOB_NOT_FOUND",
          category: "technical",
          message: "payment_job_not_found",
        });
      }
      if (
        job.leaseToken !== input.leaseToken ||
        job.status !== "claimed"
      ) {
        throw new PaymentRuntimeError({
          code: "LEASE_LOST",
          category: "technical",
          message: "payment_job_lease_lost",
          retryable: true,
        });
      }
      const ts = nowIso(input.now);
      if (input.outcome.kind === "succeeded_pending_webhook") {
        job.status = "succeeded_pending_webhook";
        job.tentativePaiementId = input.outcome.tentativePaiementId;
        job.stripePaymentIntentId = input.outcome.stripePaymentIntentId;
        job.failureCode = null;
      } else {
        job.status = input.outcome.kind;
        job.failureCode = input.outcome.failureCode;
        if (input.outcome.tentativePaiementId !== undefined) {
          job.tentativePaiementId = input.outcome.tentativePaiementId;
        }
        if (input.outcome.stripePaymentIntentId !== undefined) {
          job.stripePaymentIntentId = input.outcome.stripePaymentIntentId;
        }
      }
      job.leaseToken = null;
      job.leaseExpiresAt = null;
      job.updatedAt = ts;
      return clone(job);
    },
    async getByIdempotencyKey(key) {
      const id = byKey.get(key);
      if (!id) return null;
      const job = byId.get(id);
      return job ? clone(job) : null;
    },
    async getById(id) {
      const job = byId.get(id);
      return job ? clone(job) : null;
    },
    async listByStatus(status, limit = 50) {
      return [...byId.values()]
        .filter((j) => j.status === status)
        .slice(0, limit)
        .map(clone);
    },
  };
}

export type MemoryAttemptSeed = {
  checklist: AutomaticPaymentChecklistInput;
  rejectClaimCode?: string;
};

/**
 * Repository tentative en mémoire pour tests — simule claim/complete/fail.
 */
export function createMemoryPaymentAttemptRepository(
  seed: MemoryAttemptSeed,
): PaymentAttemptRepository & {
  setChecklist(next: AutomaticPaymentChecklistInput): void;
  tentatives: Map<
    string,
    {
      etat: string;
      stripePaymentIntentId: string | null;
      leaseToken: string | null;
      idempotencyKey: string;
    }
  >;
} {
  let checklist = structuredClone(seed.checklist);
  const tentatives = new Map<
    string,
    {
      etat: string;
      stripePaymentIntentId: string | null;
      leaseToken: string | null;
      idempotencyKey: string;
      authorizationId: string;
      stripeAccountId: string;
      stripeCustomerId: string;
      stripePaymentMethodId: string;
      montant: number;
    }
  >();

  return {
    tentatives,
    setChecklist(next) {
      checklist = structuredClone(next);
    },
    async loadChecklistSnapshot() {
      return structuredClone(checklist);
    },
    async claimAutomaticAttempt(params): Promise<TentativeClaimResult> {
      if (seed.rejectClaimCode) {
        return { status: "rejected", code: seed.rejectClaimCode };
      }
      for (const [id, t] of tentatives) {
        if (
          t.etat === "CREEE" ||
          t.etat === "NECESSITE_ACTION_CLIENT" ||
          t.etat === "EN_TRAITEMENT"
        ) {
          if (t.stripePaymentIntentId) {
            return {
              status: "already_created",
              tentativeId: id,
              stripePaymentIntentId: t.stripePaymentIntentId,
              montant: t.montant,
            };
          }
          if (t.leaseToken) {
            return { status: "in_progress", tentativeId: id };
          }
        }
      }
      const tentativeId = randomUUID();
      const leaseToken = randomUUID();
      tentatives.set(tentativeId, {
        etat: "CREEE",
        stripePaymentIntentId: null,
        leaseToken,
        idempotencyKey: params.idempotencyKey,
        authorizationId: params.authorizationId,
        stripeAccountId: params.stripeAccountId,
        stripeCustomerId: params.stripeCustomerId,
        stripePaymentMethodId: params.stripePaymentMethodId,
        montant: params.amountCents,
      });
      // Simule le trigger SQL : exige la version de garde.
      if (checklist.guardVersion !== AUTOMATIC_EXECUTION_GUARD_VERSION) {
        tentatives.delete(tentativeId);
        return { status: "rejected", code: "automatic_payment_guard_required" };
      }
      return {
        status: "claimed",
        tentativeId,
        leaseToken,
        montant: params.amountCents,
        idempotencyKey: params.idempotencyKey,
        authorizationId: params.authorizationId,
        stripeAccountId: params.stripeAccountId,
        stripeCustomerId: params.stripeCustomerId,
        stripePaymentMethodId: params.stripePaymentMethodId,
      };
    },
    async completeAutomaticAttempt(input: CompleteTentativeInput) {
      const t = tentatives.get(input.tentativeId);
      if (!t || t.leaseToken !== input.leaseToken) {
        throw new PaymentRuntimeError({
          code: "LEASE_LOST",
          category: "technical",
          message: "tentative_lease_lost",
          retryable: true,
        });
      }
      t.stripePaymentIntentId = input.stripePaymentIntentId;
      t.etat = input.localEtat;
      t.leaseToken = null;
      return { tentativeId: input.tentativeId, etat: t.etat };
    },
    async failAutomaticAttempt(input: FailTentativeInput) {
      const t = tentatives.get(input.tentativeId);
      if (!t || t.leaseToken !== input.leaseToken) {
        throw new PaymentRuntimeError({
          code: "LEASE_LOST",
          category: "technical",
          message: "tentative_lease_lost",
          retryable: true,
        });
      }
      if (!input.retryable) {
        t.etat = "ECHOUEE";
      }
      t.leaseToken = null;
      return { tentativeId: input.tentativeId, etat: t.etat };
    },
  };
}
