import "server-only";

import type Stripe from "stripe";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getStripeClient } from "@/lib/stripe/client";
import { projectAccountStatus } from "@/lib/stripe/connect/project-account-status";
import { StripeDomainError, toSafeStripeError } from "@/lib/stripe/shared/errors";
import type { Database } from "@/types/database.generated";

type AdminClient = SupabaseClient<Database>;

export async function retrieveConnectedAccount(
  accountId: string,
  stripe: Stripe = getStripeClient(),
): Promise<Stripe.Account> {
  try {
    return await stripe.accounts.retrieve(accountId);
  } catch (error) {
    throw toSafeStripeError(error);
  }
}

export async function syncConnectedAccountProjection(params: {
  supabase: AdminClient;
  prestataireId: string;
  account: Stripe.Account;
}): Promise<ReturnType<typeof projectAccountStatus>> {
  const projection = projectAccountStatus(params.account);

  const { error } = await params.supabase.rpc(
    "sync_prestataire_stripe_projection",
    {
      p_prestataire_id: params.prestataireId,
      p_stripe_account_id: projection.stripeAccountId,
      p_charges_enabled: projection.chargesEnabled,
      p_payouts_enabled: projection.payoutsEnabled,
      p_details_submitted: projection.detailsSubmitted,
      p_sepa_debit_payments_status: projection.sepaDebitPaymentsStatus,
      p_onboarding_status: projection.onboardingStatus,
      p_currently_due: projection.currentlyDue,
      p_pending_verification: projection.pendingVerification,
      p_past_due: projection.pastDue,
      p_disabled_reason: projection.disabledReason ?? "",
    },
  );

  if (error) {
    throw new StripeDomainError(
      "stripe_projection_sync_failed",
      "Échec de synchronisation de la projection Connect.",
    );
  }

  return projection;
}

/**
 * Effet account.updated transactionnel et fencé par le claim courant.
 * La projection live peut être réappliquée car elle est idempotente. Cette
 * sémantique ne doit jamais être généralisée aux futurs effets financiers.
 */
export async function applyAccountUpdatedProjection(params: {
  supabase: AdminClient;
  stripeEventId: string;
  processingAttempt: number;
  leaseToken: string;
  stripeObjectId: string;
  prestataireId: string;
  account: Stripe.Account;
}): Promise<{ effectRegistered: boolean; projectionApplied: boolean }> {
  const projection = projectAccountStatus(params.account);
  const { data, error } = await params.supabase.rpc(
    "apply_account_updated_projection",
    {
      p_stripe_event_id: params.stripeEventId,
      p_processing_attempt: params.processingAttempt,
      p_lease_token: params.leaseToken,
      p_stripe_object_id: params.stripeObjectId,
      p_prestataire_id: params.prestataireId,
      p_stripe_account_id: projection.stripeAccountId,
      p_charges_enabled: projection.chargesEnabled,
      p_payouts_enabled: projection.payoutsEnabled,
      p_details_submitted: projection.detailsSubmitted,
      p_sepa_debit_payments_status: projection.sepaDebitPaymentsStatus,
      p_onboarding_status: projection.onboardingStatus,
      p_currently_due: projection.currentlyDue,
      p_pending_verification: projection.pendingVerification,
      p_past_due: projection.pastDue,
      p_disabled_reason: projection.disabledReason ?? "",
    },
  );
  if (error) {
    if (error.message.includes("webhook_lease_lost")) {
      throw new StripeDomainError("webhook_lease_lost", undefined, "lease_lost");
    }
    throw new StripeDomainError(
      "stripe_projection_sync_failed",
      "Échec de synchronisation de la projection Connect.",
      "retryable",
    );
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new StripeDomainError(
      "stripe_projection_sync_failed",
      "Échec de synchronisation de la projection Connect.",
      "retryable",
    );
  }
  const result = data as {
    effect_registered?: unknown;
    projection_applied?: unknown;
  };
  return {
    effectRegistered: Boolean(result.effect_registered),
    projectionApplied: Boolean(result.projection_applied),
  };
}

/**
 * Revérification live obligatoire avant toute décision financière critique.
 * Ne jamais se fier à stripe_charges_enabled en base seule.
 */
export type SidianPaymentRail = "card" | "sepa_core";

export type ConnectedAccountPaymentCapabilities = {
  account: Stripe.Account;
  rails: SidianPaymentRail[];
};

/**
 * Relit une seule fois le compte Connect et dérive strictement les rails
 * réellement actifs. L'ordre est stable et ne dépend jamais du montant.
 */
export async function resolveConnectedAccountPaymentRails(params: {
  expectedAccountId: string;
  stripeAccountId: string;
  stripe?: Stripe;
}): Promise<ConnectedAccountPaymentCapabilities> {
  const account = await retrieveConnectedAccount(
    params.stripeAccountId,
    params.stripe ?? getStripeClient(),
  );

  if (account.id !== params.expectedAccountId) {
    throw new StripeDomainError("stripe_account_scope_mismatch");
  }

  const requirements = account.requirements;
  const restricted =
    Boolean(requirements?.disabled_reason) ||
    (requirements?.past_due?.length ?? 0) > 0;
  if (account.charges_enabled !== true || restricted) {
    return { account, rails: [] };
  }

  const rails: SidianPaymentRail[] = [];
  if (account.capabilities?.card_payments === "active") {
    rails.push("card");
  }
  if (account.capabilities?.sepa_debit_payments === "active") {
    rails.push("sepa_core");
  }

  return { account, rails };
}

export async function assertConnectedAccountEligibleForPaymentRail(params: {
  expectedAccountId: string;
  stripeAccountId: string;
  rail: SidianPaymentRail;
  stripe?: Stripe;
}): Promise<Stripe.Account> {
  const { account, rails } = await resolveConnectedAccountPaymentRails(params);
  if (!rails.includes(params.rail)) {
    throw new StripeDomainError(
      "stripe_account_not_eligible_for_payment_rail",
      "Le compte Connect n'est pas éligible au moyen de paiement demandé.",
    );
  }

  return account;
}

/** Compatibilité interne : les nouveaux flux doivent choisir explicitement un rail. */
export async function assertConnectedAccountPayable(params: {
  stripeAccountId: string;
  stripe?: Stripe;
}): Promise<Stripe.Account> {
  return assertConnectedAccountEligibleForPaymentRail({
    expectedAccountId: params.stripeAccountId,
    stripeAccountId: params.stripeAccountId,
    rail: "card",
    stripe: params.stripe,
  });
}
