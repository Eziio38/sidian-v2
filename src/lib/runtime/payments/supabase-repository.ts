import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveConnectedAccountPaymentRails } from "@/lib/stripe/connect/retrieve-and-sync";
import type { Database } from "@/types/database.generated";

import {
  AUTO_DEBIT_REGLE_CEILING_PRODUCT_READY,
  AUTOMATIC_EXECUTION_GUARD_VERSION,
} from "./constants";
import { PaymentRuntimeError } from "./errors";
import type {
  CompleteTentativeInput,
  FailTentativeInput,
  PaymentAttemptRepository,
  PaymentJobRepository,
  EnqueuePaymentJobInput,
  ClaimPaymentJobResult,
  CompletePaymentJobInput,
  TentativeClaimResult,
} from "./repository";
import type {
  AutomaticPaymentChecklistInput,
  PaymentJob,
  PaymentJobStatus,
} from "./types";

type AdminClient = SupabaseClient<Database>;

type JobRow = {
  id: string;
  prestataire_id: string;
  creance_id: string;
  amount_cents: number;
  currency: string;
  source: "scanner" | "agent_tool";
  idempotency_key: string;
  status: PaymentJobStatus;
  lease_token: string | null;
  lease_expires_at: string | null;
  tentative_paiement_id: string | null;
  stripe_payment_intent_id: string | null;
  failure_code: string | null;
  correlation_id: string | null;
  attempt_count: number;
  created_at: string;
  updated_at: string;
};

function mapJob(row: JobRow): PaymentJob {
  return {
    id: row.id,
    prestataireId: row.prestataire_id,
    creanceId: row.creance_id,
    amountCents: row.amount_cents,
    currency: "EUR",
    source: row.source,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at,
    tentativePaiementId: row.tentative_paiement_id,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    failureCode: row.failure_code,
    correlationId: row.correlation_id,
    attemptCount: row.attempt_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Repository jobs via RPC service_role (table payment_execution_job).
 * Typage RPC assoupli tant que `supabase:types` n'a pas été régénéré.
 */
export function createSupabasePaymentJobRepository(
  admin: AdminClient,
): PaymentJobRepository {
  const rpc = admin.rpc.bind(admin) as unknown as (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;

  return {
    async enqueue(input: EnqueuePaymentJobInput) {
      const { data, error } = await rpc("enqueue_payment_execution_job", {
        p_prestataire_id: input.prestataireId,
        p_creance_id: input.creanceId,
        p_amount_cents: input.amountCents,
        p_currency: input.currency,
        p_source: input.source,
        p_idempotency_key: input.idempotencyKey,
        p_correlation_id: input.correlationId ?? null,
      });
      if (error) {
        if (error.message.includes("payment_job_idempotency_conflict")) {
          throw new PaymentRuntimeError({
            code: "DUPLICATE_REQUEST",
            category: "business",
            message: "payment_job_idempotency_conflict",
          });
        }
        throw new PaymentRuntimeError({
          code: "PROVIDER_UNAVAILABLE",
          category: "technical",
          message: "enqueue_payment_execution_job_failed",
          retryable: true,
        });
      }
      return mapJob(data as JobRow);
    },

    async claimNext({ leaseSeconds }) {
      const { data, error } = await rpc("claim_payment_execution_job", {
        p_job_id: null,
        p_lease_seconds: leaseSeconds,
      });
      if (error) {
        throw new PaymentRuntimeError({
          code: "PROVIDER_UNAVAILABLE",
          category: "technical",
          message: "claim_payment_execution_job_failed",
          retryable: true,
        });
      }
      if (!data) return { status: "not_found" };
      const payload = data as { status: string; job: JobRow; lease_token?: string };
      if (payload.status === "not_found") return { status: "not_found" };
      if (payload.status === "in_progress") {
        return { status: "in_progress", job: mapJob(payload.job) };
      }
      if (payload.status === "already_terminal") {
        return { status: "already_terminal", job: mapJob(payload.job) };
      }
      return {
        status: "claimed",
        job: mapJob(payload.job),
        leaseToken: String(payload.lease_token),
      };
    },

    async claimById({ jobId, leaseSeconds }) {
      const { data, error } = await rpc("claim_payment_execution_job", {
        p_job_id: jobId,
        p_lease_seconds: leaseSeconds,
      });
      if (error) {
        throw new PaymentRuntimeError({
          code: "PROVIDER_UNAVAILABLE",
          category: "technical",
          message: "claim_payment_execution_job_failed",
          retryable: true,
        });
      }
      if (!data) return { status: "not_found" };
      const payload = data as { status: string; job: JobRow; lease_token?: string };
      if (payload.status === "not_found") return { status: "not_found" };
      if (payload.status === "in_progress") {
        return { status: "in_progress", job: mapJob(payload.job) };
      }
      if (payload.status === "already_terminal") {
        return { status: "already_terminal", job: mapJob(payload.job) };
      }
      return {
        status: "claimed",
        job: mapJob(payload.job),
        leaseToken: String(payload.lease_token),
      };
    },

    async complete(input: CompletePaymentJobInput) {
      const { data, error } = await rpc("complete_payment_execution_job", {
        p_job_id: input.jobId,
        p_lease_token: input.leaseToken,
        p_outcome: input.outcome.kind,
        p_failure_code:
          input.outcome.kind === "succeeded_pending_webhook"
            ? null
            : input.outcome.failureCode,
        p_tentative_paiement_id:
          input.outcome.kind === "succeeded_pending_webhook"
            ? input.outcome.tentativePaiementId
            : (input.outcome.tentativePaiementId ?? null),
        p_stripe_payment_intent_id:
          input.outcome.kind === "succeeded_pending_webhook"
            ? input.outcome.stripePaymentIntentId
            : (input.outcome.stripePaymentIntentId ?? null),
      });
      if (error) {
        if (error.message.includes("payment_job_lease_lost")) {
          throw new PaymentRuntimeError({
            code: "LEASE_LOST",
            category: "technical",
            message: "payment_job_lease_lost",
            retryable: true,
          });
        }
        throw new PaymentRuntimeError({
          code: "PROVIDER_UNAVAILABLE",
          category: "technical",
          message: "complete_payment_execution_job_failed",
          retryable: true,
        });
      }
      return mapJob(data as JobRow);
    },

    async getByIdempotencyKey(key) {
      const { data, error } = await admin
        .from("payment_execution_job" as never)
        .select("*")
        .eq("idempotency_key" as never, key)
        .maybeSingle();
      if (error) {
        throw new PaymentRuntimeError({
          code: "PROVIDER_UNAVAILABLE",
          category: "technical",
          message: "payment_job_lookup_failed",
          retryable: true,
        });
      }
      return data ? mapJob(data as unknown as JobRow) : null;
    },

    async getById(id) {
      const { data, error } = await admin
        .from("payment_execution_job" as never)
        .select("*")
        .eq("id" as never, id)
        .maybeSingle();
      if (error) {
        throw new PaymentRuntimeError({
          code: "PROVIDER_UNAVAILABLE",
          category: "technical",
          message: "payment_job_lookup_failed",
          retryable: true,
        });
      }
      return data ? mapJob(data as unknown as JobRow) : null;
    },

    async listByStatus(status, limit = 50) {
      const { data, error } = await admin
        .from("payment_execution_job" as never)
        .select("*")
        .eq("status" as never, status)
        .limit(limit);
      if (error) {
        throw new PaymentRuntimeError({
          code: "PROVIDER_UNAVAILABLE",
          category: "technical",
          message: "payment_job_list_failed",
          retryable: true,
        });
      }
      return ((data as unknown as JobRow[] | null) ?? []).map(mapJob);
    },
  };
}

export function createSupabasePaymentAttemptRepository(
  admin: AdminClient,
  options?: { paymentsEnabled?: boolean },
): PaymentAttemptRepository {
  const rpc = admin.rpc.bind(admin) as unknown as (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;

  return {
    async loadChecklistSnapshot(params): Promise<AutomaticPaymentChecklistInput> {
      const { data, error } = await rpc("load_automatic_payment_checklist", {
        p_creance_id: params.creanceId,
        p_prestataire_id: params.prestataireId,
      });
      if (error || !data || typeof data !== "object") {
        throw new PaymentRuntimeError({
          code: "PROVIDER_UNAVAILABLE",
          category: "technical",
          message: "load_automatic_payment_checklist_failed",
          retryable: true,
        });
      }

      const row = data as {
        creance: {
          id: string;
          prestataire_id: string;
          client_payeur_id: string;
          etat: string;
          devise: string;
          montant: number;
          archived_at: string | null;
          amount_paid_cents: number;
          remaining_cents: number;
        };
        dossier_etat: string | null;
        authorization: {
          id: string;
          prestataire_id: string;
          client_payeur_id: string;
          etat: string;
          is_default: boolean;
          legacy_incomplete: boolean;
          type: "card_off_session" | "sepa_core_mandate" | null;
          stripe_account_id: string | null;
          stripe_customer_id: string | null;
          stripe_payment_method_id: string | null;
          accepted_at: string | null;
          authorized_at: string | null;
          authorization_text_version: string | null;
          authorization_channel: string | null;
        } | null;
        active_attempt: {
          id: string;
          etat: string;
          source: string;
          stripe_payment_intent_id: string | null;
        } | null;
      };

      let connect = null;
      const accountId = row.authorization?.stripe_account_id ?? null;
      if (accountId) {
        try {
          const live = await resolveConnectedAccountPaymentRails({
            expectedAccountId: accountId,
            stripeAccountId: accountId,
          });
          const requirements = live.account.requirements;
          const restricted =
            Boolean(requirements?.disabled_reason) ||
            (requirements?.past_due?.length ?? 0) > 0;
          connect = {
            stripeAccountId: accountId,
            cardPaymentsActive: live.rails.includes("card"),
            chargesEnabled: live.account.charges_enabled === true,
            restricted,
          };
        } catch {
          connect = {
            stripeAccountId: accountId,
            cardPaymentsActive: false,
            chargesEnabled: false,
            restricted: true,
          };
        }
      }

      return {
        paymentsEnabled:
          options?.paymentsEnabled ?? params.paymentsEnabled,
        creance: {
          id: row.creance.id,
          prestataireId: row.creance.prestataire_id,
          clientPayeurId: row.creance.client_payeur_id,
          etat: row.creance.etat,
          devise: row.creance.devise,
          montant: row.creance.montant,
          archivedAt: row.creance.archived_at,
          amountPaidCents: row.creance.amount_paid_cents,
          remainingCents: row.creance.remaining_cents,
        },
        dossier: row.dossier_etat
          ? { creanceId: row.creance.id, etat: row.dossier_etat }
          : null,
        authorization: row.authorization
          ? {
              id: row.authorization.id,
              prestataireId: row.authorization.prestataire_id,
              clientPayeurId: row.authorization.client_payeur_id,
              etat: row.authorization.etat,
              isDefault: row.authorization.is_default,
              legacyIncomplete: row.authorization.legacy_incomplete,
              type: row.authorization.type,
              stripeAccountId: row.authorization.stripe_account_id,
              stripeCustomerId: row.authorization.stripe_customer_id,
              stripePaymentMethodId: row.authorization.stripe_payment_method_id,
              acceptedAt: row.authorization.accepted_at,
              authorizedAt: row.authorization.authorized_at,
              authorizationTextVersion:
                row.authorization.authorization_text_version,
              authorizationChannel: row.authorization.authorization_channel,
            }
          : null,
        activeAttempt: row.active_attempt
          ? {
              id: row.active_attempt.id,
              etat: row.active_attempt.etat,
              source: row.active_attempt.source,
              stripePaymentIntentId:
                row.active_attempt.stripe_payment_intent_id,
            }
          : null,
        connect,
        requestedAmountCents: params.requestedAmountCents,
        requestedCurrency: params.requestedCurrency,
        autoDebitCeilingCents: null,
        productAutoDebitRulesReady: AUTO_DEBIT_REGLE_CEILING_PRODUCT_READY,
        guardVersion: AUTOMATIC_EXECUTION_GUARD_VERSION,
      };
    },

    async claimAutomaticAttempt(params): Promise<TentativeClaimResult> {
      const { data, error } = await rpc("claim_automatic_payment_attempt", {
        p_creance_id: params.creanceId,
        p_prestataire_id: params.prestataireId,
        p_amount_cents: params.amountCents,
        p_authorization_id: params.authorizationId,
        p_stripe_account_id: params.stripeAccountId,
        p_stripe_customer_id: params.stripeCustomerId,
        p_idempotency_key: params.idempotencyKey,
        p_lease_seconds: params.leaseSeconds,
        p_guard_version: AUTOMATIC_EXECUTION_GUARD_VERSION,
      });
      if (error) {
        return { status: "rejected", code: error.message };
      }
      const payload = data as {
        status: string;
        tentative_id?: string;
        lease_token?: string;
        montant?: number;
        idempotency_key?: string;
        authorization_id?: string;
        stripe_account_id?: string;
        stripe_customer_id?: string;
        stripe_payment_method_id?: string;
        stripe_payment_intent_id?: string;
        code?: string;
      };

      if (payload.status === "rejected") {
        return { status: "rejected", code: payload.code ?? "rejected" };
      }
      if (payload.status === "in_progress") {
        return { status: "in_progress", tentativeId: String(payload.tentative_id) };
      }
      if (payload.status === "already_created") {
        return {
          status: "already_created",
          tentativeId: String(payload.tentative_id),
          stripePaymentIntentId: String(payload.stripe_payment_intent_id),
          montant: Number(payload.montant),
        };
      }
      return {
        status: payload.status === "reclaimed" ? "reclaimed" : "claimed",
        tentativeId: String(payload.tentative_id),
        leaseToken: String(payload.lease_token),
        montant: Number(payload.montant),
        idempotencyKey: String(payload.idempotency_key),
        authorizationId: String(payload.authorization_id),
        stripeAccountId: String(payload.stripe_account_id),
        stripeCustomerId: String(payload.stripe_customer_id),
        stripePaymentMethodId: params.stripePaymentMethodId,
      };
    },

    async completeAutomaticAttempt(input: CompleteTentativeInput) {
      const { data, error } = await rpc("complete_automatic_payment_attempt", {
        p_tentative_id: input.tentativeId,
        p_lease_token: input.leaseToken,
        p_stripe_payment_intent_id: input.stripePaymentIntentId,
        p_stripe_account_id: input.stripeAccountId,
        p_stripe_customer_id: input.stripeCustomerId,
        p_application_fee_amount: input.applicationFeeAmount,
        p_local_etat: input.localEtat,
      });
      if (error) {
        if (error.message.includes("checkout_lease_lost") ||
          error.message.includes("automatic_lease_lost")) {
          throw new PaymentRuntimeError({
            code: "LEASE_LOST",
            category: "technical",
            message: "automatic_lease_lost",
            retryable: true,
          });
        }
        throw new PaymentRuntimeError({
          code: "PROVIDER_UNAVAILABLE",
          category: "technical",
          message: "complete_automatic_payment_attempt_failed",
          retryable: true,
        });
      }
      const row = data as { id: string; etat: string };
      return { tentativeId: row.id, etat: row.etat };
    },

    async failAutomaticAttempt(input: FailTentativeInput) {
      const { data, error } = await rpc("fail_automatic_payment_attempt", {
        p_tentative_id: input.tentativeId,
        p_lease_token: input.leaseToken,
        p_retryable: input.retryable,
        p_error_code: input.errorCode,
      });
      if (error) {
        throw new PaymentRuntimeError({
          code: "LEASE_LOST",
          category: "technical",
          message: "fail_automatic_payment_attempt_failed",
          retryable: true,
        });
      }
      const row = data as { id: string; etat: string };
      return { tentativeId: row.id, etat: row.etat };
    },
  };
}
