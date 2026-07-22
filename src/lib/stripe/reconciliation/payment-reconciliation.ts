import "server-only";

import { createHash } from "node:crypto";

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getSidianEnvironment,
  type SidianEnvironment,
} from "@/config/env-server";
import { getStripeClient } from "@/lib/stripe/client";
import { assertConnectedAccountIdentity } from "@/lib/stripe/connect/account-identity";
import { projectAccountStatus } from "@/lib/stripe/connect/project-account-status";
import {
  retrieveConnectedAccount,
  syncConnectedAccountProjection,
} from "@/lib/stripe/connect/retrieve-and-sync";
import { classifyStripeFailure } from "@/lib/stripe/shared/errors";
import type { Database } from "@/types/database.generated";

import {
  inspectLivePaymentAttempt,
  type LocalReconciliationAttempt,
  type ReconciliationEffectType,
  type ReconciliationHumanReason,
  type ReconciliationObservation,
} from "./payment-reconciliation-core";

type DbClient = SupabaseClient<Database>;

const MAX_RECONCILED_ATTEMPTS = 25;

type LocalPrestataire = Pick<
  Database["public"]["Tables"]["prestataire"]["Row"],
  | "id"
  | "stripe_account_id"
  | "stripe_connect_operation_key"
  | "stripe_charges_enabled"
  | "stripe_payouts_enabled"
  | "stripe_details_submitted"
  | "stripe_onboarding_status"
  | "stripe_requirements_currently_due"
  | "stripe_requirements_pending_verification"
  | "stripe_requirements_past_due"
  | "stripe_disabled_reason"
  | "stripe_sepa_debit_payments_status"
>;

type LocalAttemptRow = Pick<
  Database["public"]["Tables"]["tentative_paiement"]["Row"],
  | "id"
  | "montant"
  | "moyen"
  | "source"
  | "etat"
  | "stripe_account_id"
  | "stripe_checkout_session_id"
  | "stripe_payment_intent_id"
  | "stripe_customer_id"
  | "application_fee_amount"
  | "checkout_provisioning_status"
  | "created_at"
>;

type ConfirmedPaymentRow = Pick<
  Database["public"]["Tables"]["paiement"]["Row"],
  "tentative_paiement_id" | "montant" | "source"
>;

export type PaymentReconciliationResult = {
  status:
    | "repaired"
    | "up_to_date"
    | "pending"
    | "no_activity"
    | "human_required"
    | "retry";
  projectionRepaired: boolean;
};

type LoadedContext = {
  prestataire: LocalPrestataire;
  receivable: {
    id: string;
    client_payeur_id: string;
    devise: string;
  };
  attempts: LocalAttemptRow[];
  payments: ConfirmedPaymentRow[];
};

type Aggregate = {
  repaired: number;
  current: number;
  pending: number;
  human: number;
  retry: number;
};

function stableFingerprint(input: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex");
}

function idOf(
  value: string | { id?: string | null } | null | undefined,
): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (
    value &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    value.id.trim()
  ) {
    return value.id;
  }
  return null;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function projectionDiffers(
  prestataire: LocalPrestataire,
  account: Stripe.Account,
): boolean {
  const projection = projectAccountStatus(account);
  return (
    prestataire.stripe_account_id !== projection.stripeAccountId ||
    prestataire.stripe_charges_enabled !== projection.chargesEnabled ||
    prestataire.stripe_payouts_enabled !== projection.payoutsEnabled ||
    prestataire.stripe_details_submitted !== projection.detailsSubmitted ||
    prestataire.stripe_onboarding_status !== projection.onboardingStatus ||
    prestataire.stripe_sepa_debit_payments_status !==
      projection.sepaDebitPaymentsStatus ||
    prestataire.stripe_disabled_reason !== projection.disabledReason ||
    !jsonEqual(
      prestataire.stripe_requirements_currently_due,
      projection.currentlyDue,
    ) ||
    !jsonEqual(
      prestataire.stripe_requirements_pending_verification,
      projection.pendingVerification,
    ) ||
    !jsonEqual(
      prestataire.stripe_requirements_past_due,
      projection.pastDue,
    )
  );
}

async function loadContext(params: {
  supabaseUser: DbClient;
  userId: string;
  receivableId: string;
}): Promise<LoadedContext> {
  const prestataireResult = await params.supabaseUser
    .from("prestataire")
    .select(
      "id, stripe_account_id, stripe_connect_operation_key, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted, stripe_onboarding_status, stripe_requirements_currently_due, stripe_requirements_pending_verification, stripe_requirements_past_due, stripe_disabled_reason, stripe_sepa_debit_payments_status",
    )
    .eq("user_id", params.userId)
    .maybeSingle();
  if (prestataireResult.error) {
    throw new Error("payment_reconciliation_context_unavailable");
  }
  if (!prestataireResult.data) {
    throw new Error("payment_reconciliation_not_found");
  }

  const receivableResult = await params.supabaseUser
    .from("creance")
    .select("id, client_payeur_id, devise")
    .eq("id", params.receivableId)
    .eq("prestataire_id", prestataireResult.data.id)
    .maybeSingle();
  if (receivableResult.error) {
    throw new Error("payment_reconciliation_context_unavailable");
  }
  if (!receivableResult.data) {
    throw new Error("payment_reconciliation_not_found");
  }

  const [attemptsResult, paymentsResult] = await Promise.all([
    params.supabaseUser
      .from("tentative_paiement")
      .select(
        "id, montant, moyen, source, etat, stripe_account_id, stripe_checkout_session_id, stripe_payment_intent_id, stripe_customer_id, application_fee_amount, checkout_provisioning_status, created_at",
      )
      .eq("creance_id", receivableResult.data.id)
      .order("created_at", { ascending: true }),
    params.supabaseUser
      .from("paiement")
      .select("tentative_paiement_id, montant, source")
      .eq("creance_id", receivableResult.data.id),
  ]);
  if (attemptsResult.error || paymentsResult.error) {
    throw new Error("payment_reconciliation_context_unavailable");
  }

  return {
    prestataire: prestataireResult.data,
    receivable: receivableResult.data,
    attempts: attemptsResult.data ?? [],
    payments: paymentsResult.data ?? [],
  };
}

async function registerHumanRequired(params: {
  supabaseAdmin: DbClient;
  userId: string;
  receivableId: string;
  tentativeId: string | null;
  reason: ReconciliationHumanReason;
  evidence: Record<string, unknown>;
}): Promise<void> {
  const reconciliationKey = stableFingerprint({
    version: 1,
    receivableId: params.receivableId,
    tentativeId: params.tentativeId,
    reason: params.reason,
    ...params.evidence,
  });
  const { error } = await params.supabaseAdmin.rpc(
    "register_payment_reconciliation_human_required",
    {
      p_requester_user_id: params.userId,
      p_creance_id: params.receivableId,
      p_tentative_id: params.tentativeId,
      p_reconciliation_key: reconciliationKey,
      p_reason: params.reason,
    },
  );
  if (error) {
    throw new Error("payment_reconciliation_guard_persistence_failed");
  }
}

async function applySafeEffect(params: {
  supabaseAdmin: DbClient;
  userId: string;
  receivableId: string;
  tentativeId: string;
  effect: ReconciliationEffectType;
  sidianEnvironment: SidianEnvironment;
  observation: ReconciliationObservation;
}): Promise<"repaired" | "up_to_date" | "retry"> {
  const { data, error } = await params.supabaseAdmin.rpc(
    "apply_safe_eur_payment_reconciliation",
    {
      p_requester_user_id: params.userId,
      p_creance_id: params.receivableId,
      p_tentative_id: params.tentativeId,
      p_effect_type: params.effect,
      p_sidian_environment: params.sidianEnvironment,
      p_observation: params.observation,
    },
  );
  if (error) {
    const message = error.message ?? "";
    if (message.includes("payment_reconciliation_") || message.includes("scope_mismatch")) {
      throw new Error("payment_reconciliation_live_observation_rejected");
    }
    throw new Error("payment_reconciliation_effect_failed");
  }
  const outcome = (data as { outcome?: unknown } | null)?.outcome;
  if (outcome === "repaired" || outcome === "up_to_date" || outcome === "retry") {
    return outcome;
  }
  throw new Error("payment_reconciliation_effect_failed");
}

async function retrieveAttemptObjects(params: {
  stripe: Stripe;
  stripeAccountId: string;
  sessionId: string;
}): Promise<
  | {
      ok: true;
      session: Stripe.Checkout.Session;
      paymentIntent: Stripe.PaymentIntent;
      customer: Stripe.Customer | Stripe.DeletedCustomer;
    }
  | { ok: false; retryable: boolean; evidenceCode: string }
> {
  let session: Stripe.Checkout.Session;
  try {
    session = await params.stripe.checkout.sessions.retrieve(
      params.sessionId,
      {},
      { stripeAccount: params.stripeAccountId },
    );
  } catch (error) {
    const failure = classifyStripeFailure(error);
    return {
      ok: false,
      retryable: failure.disposition !== "terminal",
      evidenceCode: failure.code,
    };
  }

  const paymentIntentId = idOf(session.payment_intent);
  const customerId = idOf(session.customer);
  if (!paymentIntentId || !customerId) {
    return { ok: false, retryable: false, evidenceCode: "missing_related_object" };
  }

  try {
    const [paymentIntent, customer] = await Promise.all([
      params.stripe.paymentIntents.retrieve(
        paymentIntentId,
        { expand: ["latest_charge"] },
        { stripeAccount: params.stripeAccountId },
      ),
      params.stripe.customers.retrieve(
        customerId,
        {},
        { stripeAccount: params.stripeAccountId },
      ),
    ]);
    return { ok: true, session, paymentIntent, customer };
  } catch (error) {
    const failure = classifyStripeFailure(error);
    return {
      ok: false,
      retryable: failure.disposition !== "terminal",
      evidenceCode: failure.code,
    };
  }
}

function aggregateStatus(aggregate: Aggregate): PaymentReconciliationResult["status"] {
  if (aggregate.human > 0) return "human_required";
  if (aggregate.retry > 0) return "retry";
  if (aggregate.repaired > 0) return "repaired";
  if (aggregate.pending > 0) return "pending";
  if (aggregate.current > 0) return "up_to_date";
  return "no_activity";
}

/**
 * Commande de réconciliation prestataire. Le navigateur ne fournit que l'UUID
 * de la ressource ; identité, montants, devise et références Stripe sont relus
 * derrière la session puis chez Stripe Connect.
 */
export async function reconcilePaymentReceivableFromStripe(params: {
  supabaseUser: DbClient;
  supabaseAdmin: DbClient;
  userId: string;
  receivableId: string;
  stripe?: Stripe;
  sidianEnvironment?: SidianEnvironment;
}): Promise<PaymentReconciliationResult> {
  const context = await loadContext(params);
  const sidianEnvironment =
    params.sidianEnvironment ?? getSidianEnvironment();
  const stripe = params.stripe ?? getStripeClient();
  const aggregate: Aggregate = {
    repaired: 0,
    current: 0,
    pending: 0,
    human: 0,
    retry: 0,
  };

  if (context.receivable.devise !== "EUR") {
    await registerHumanRequired({
      supabaseAdmin: params.supabaseAdmin,
      userId: params.userId,
      receivableId: context.receivable.id,
      tentativeId: null,
      reason: "stripe_currency_mismatch",
      evidence: { localCurrency: context.receivable.devise },
    });
    return { status: "human_required", projectionRepaired: false };
  }

  const stripeAccountId = context.prestataire.stripe_account_id?.trim() ?? "";
  if (!stripeAccountId) {
    const hasStripeEvidence = context.attempts.some(
      (attempt) =>
        attempt.stripe_account_id !== null ||
        attempt.stripe_checkout_session_id !== null ||
        attempt.stripe_payment_intent_id !== null ||
        attempt.stripe_customer_id !== null,
    );
    if (hasStripeEvidence) {
      await registerHumanRequired({
        supabaseAdmin: params.supabaseAdmin,
        userId: params.userId,
        receivableId: context.receivable.id,
        tentativeId: null,
        reason: "account_identity_mismatch",
        evidence: { localAccountMissing: true },
      });
      return { status: "human_required", projectionRepaired: false };
    }
    return { status: "no_activity", projectionRepaired: false };
  }

  let account: Stripe.Account;
  try {
    const retrieved = await retrieveConnectedAccount(stripeAccountId, stripe);
    account = assertConnectedAccountIdentity({
      account: retrieved,
      expectedAccountId: stripeAccountId,
      prestataireId: context.prestataire.id,
      operationKey: context.prestataire.stripe_connect_operation_key,
      sidianEnvironment,
    });
  } catch (error) {
    const failure = classifyStripeFailure(error);
    if (failure.disposition !== "terminal") {
      return { status: "retry", projectionRepaired: false };
    }
    await registerHumanRequired({
      supabaseAdmin: params.supabaseAdmin,
      userId: params.userId,
      receivableId: context.receivable.id,
      tentativeId: null,
      reason: "account_identity_mismatch",
      evidence: { failureCode: failure.code },
    });
    return { status: "human_required", projectionRepaired: false };
  }

  const projectionRepaired = projectionDiffers(context.prestataire, account);
  try {
    await syncConnectedAccountProjection({
      supabase: params.supabaseAdmin,
      prestataireId: context.prestataire.id,
      account,
    });
  } catch {
    // Une projection non persistée ferme la commande avant tout effet financier.
    return { status: "retry", projectionRepaired: false };
  }

  if (context.attempts.length > MAX_RECONCILED_ATTEMPTS) {
    await registerHumanRequired({
      supabaseAdmin: params.supabaseAdmin,
      userId: params.userId,
      receivableId: context.receivable.id,
      tentativeId: null,
      reason: "too_many_attempts",
      evidence: { boundedAt: MAX_RECONCILED_ATTEMPTS },
    });
    return { status: "human_required", projectionRepaired };
  }

  const paymentsByAttempt = new Map(
    context.payments
      .filter(
        (payment): payment is ConfirmedPaymentRow & {
          tentative_paiement_id: string;
        } => payment.tentative_paiement_id !== null,
      )
      .map((payment) => [payment.tentative_paiement_id, payment]),
  );

  for (const attempt of context.attempts) {
    const sessionId = attempt.stripe_checkout_session_id?.trim() ?? "";
    if (!sessionId) {
      const inconsistent =
        attempt.checkout_provisioning_status === "created" ||
        attempt.stripe_payment_intent_id !== null ||
        attempt.stripe_customer_id !== null;
      if (inconsistent) {
        await registerHumanRequired({
          supabaseAdmin: params.supabaseAdmin,
          userId: params.userId,
          receivableId: context.receivable.id,
          tentativeId: attempt.id,
          reason: "stripe_object_missing",
          evidence: { provisioningStatus: attempt.checkout_provisioning_status },
        });
        aggregate.human += 1;
      }
      continue;
    }

    if (attempt.stripe_account_id !== stripeAccountId) {
      await registerHumanRequired({
        supabaseAdmin: params.supabaseAdmin,
        userId: params.userId,
        receivableId: context.receivable.id,
        tentativeId: attempt.id,
        reason: "account_identity_mismatch",
        evidence: { attemptAccountMatches: false },
      });
      aggregate.human += 1;
      continue;
    }

    const objects = await retrieveAttemptObjects({
      stripe,
      stripeAccountId,
      sessionId,
    });
    if (!objects.ok) {
      if (objects.retryable) {
        aggregate.retry += 1;
      } else {
        await registerHumanRequired({
          supabaseAdmin: params.supabaseAdmin,
          userId: params.userId,
          receivableId: context.receivable.id,
          tentativeId: attempt.id,
          reason: "stripe_object_missing",
          evidence: { evidenceCode: objects.evidenceCode },
        });
        aggregate.human += 1;
      }
      continue;
    }

    const payment = paymentsByAttempt.get(attempt.id) ?? null;
    const local: LocalReconciliationAttempt = {
      id: attempt.id,
      creanceId: context.receivable.id,
      prestataireId: context.prestataire.id,
      clientPayeurId: context.receivable.client_payeur_id,
      stripeAccountId,
      stripeCheckoutSessionId: sessionId,
      stripePaymentIntentId: attempt.stripe_payment_intent_id,
      stripeCustomerId: attempt.stripe_customer_id,
      amount: attempt.montant,
      applicationFeeAmount: attempt.application_fee_amount ?? 0,
      currency: context.receivable.devise,
      source: attempt.source,
      moyen: attempt.moyen,
      state: attempt.etat,
      confirmedPayment: payment
        ? { amount: payment.montant, source: payment.source }
        : null,
      sidianEnvironment,
    };
    const inspection = inspectLivePaymentAttempt({
      local,
      live: {
        account,
        session: objects.session,
        paymentIntent: objects.paymentIntent,
        customer: objects.customer,
      },
    });

    if (inspection.outcome === "pending") {
      aggregate.pending += 1;
      continue;
    }
    if (inspection.outcome === "human_required") {
      await registerHumanRequired({
        supabaseAdmin: params.supabaseAdmin,
        userId: params.userId,
        receivableId: context.receivable.id,
        tentativeId: attempt.id,
        reason: inspection.reason,
        evidence: {
          sessionStatus: objects.session.status,
          paymentStatus: objects.session.payment_status,
          paymentIntentStatus: objects.paymentIntent.status,
        },
      });
      aggregate.human += 1;
      continue;
    }

    if (inspection.effects.length === 0) {
      aggregate.current += 1;
      continue;
    }

    let effectRejected = false;
    for (const effect of inspection.effects) {
      try {
        const outcome = await applySafeEffect({
          supabaseAdmin: params.supabaseAdmin,
          userId: params.userId,
          receivableId: context.receivable.id,
          tentativeId: attempt.id,
          effect,
          sidianEnvironment,
          observation: inspection.observation,
        });
        if (outcome === "repaired") aggregate.repaired += 1;
        else if (outcome === "up_to_date") aggregate.current += 1;
        else aggregate.retry += 1;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "payment_reconciliation_live_observation_rejected"
        ) {
          await registerHumanRequired({
            supabaseAdmin: params.supabaseAdmin,
            userId: params.userId,
            receivableId: context.receivable.id,
            tentativeId: attempt.id,
            reason: "local_financial_state_mismatch",
            evidence: { effect },
          });
          aggregate.human += 1;
          effectRejected = true;
          break;
        }
        throw error;
      }
    }
    if (effectRejected) continue;
  }

  return {
    status: aggregateStatus(aggregate),
    projectionRepaired,
  };
}
