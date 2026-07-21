import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import {
  getSidianEnvironment,
  type SidianEnvironment,
} from "@/config/env-server";
import { assertConnectedAccountIdentity } from "@/lib/stripe/connect/account-identity";
import { projectAccountStatus } from "@/lib/stripe/connect/project-account-status";
import {
  retrieveConnectedAccount,
  syncConnectedAccountProjection,
} from "@/lib/stripe/connect/retrieve-and-sync";
import { StripeDomainError } from "@/lib/stripe/shared/errors";
import type { Database } from "@/types/database.generated";

type Db = Database;

export type StripeCapabilityView = "inactive" | "pending" | "active";

export type StripeConnectAccountView = {
  configured: boolean;
  onboardingStatus:
    | "non_commence"
    | "configuration_commencee"
    | "informations_requises"
    | "verification_en_cours"
    | "paiements_actives"
    | "paiements_indisponibles"
    | "action_requise";
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  cardPaymentsStatus: StripeCapabilityView;
  sepaDebitPaymentsStatus: StripeCapabilityView;
  currentlyDueCount: number;
  pendingVerificationCount: number;
  pastDueCount: number;
  canOpenOnboarding: boolean;
  requiredRailsActive: boolean;
};

const NOT_CONFIGURED_VIEW: StripeConnectAccountView = {
  configured: false,
  onboardingStatus: "non_commence",
  chargesEnabled: false,
  payoutsEnabled: false,
  cardPaymentsStatus: "inactive",
  sepaDebitPaymentsStatus: "inactive",
  currentlyDueCount: 0,
  pendingVerificationCount: 0,
  pastDueCount: 0,
  canOpenOnboarding: true,
  requiredRailsActive: false,
};

function capabilityView(
  status: Stripe.Account.Capabilities[keyof Stripe.Account.Capabilities],
): StripeCapabilityView {
  if (status === "active") return "active";
  if (status === "pending") return "pending";
  return "inactive";
}

/**
 * Un Account Link Express sert uniquement à collecter les exigences Stripe.
 * `account_update` est exclu pour les comptes ayant un Dashboard Express.
 */
export function shouldOpenConnectedAccountOnboarding(
  account: Pick<Stripe.Account, "details_submitted" | "requirements">,
): boolean {
  if (account.details_submitted !== true) return true;

  return (
    (account.requirements?.currently_due?.length ?? 0) > 0 ||
    (account.requirements?.past_due?.length ?? 0) > 0
  );
}

/**
 * DTO d'affichage issu d'une lecture Stripe live. Aucun identifiant Stripe ni
 * détail d'exigence KYC n'est transmis au composant client.
 */
export async function getCurrentPrestataireStripeConnectView(params: {
  supabaseUser: SupabaseClient<Db>;
  supabaseAdmin: SupabaseClient<Db>;
  stripe?: Stripe;
  sidianEnvironment?: SidianEnvironment;
}): Promise<StripeConnectAccountView> {
  const { data: authData, error: authError } =
    await params.supabaseUser.auth.getUser();
  if (authError || !authData.user) {
    throw new StripeDomainError("not_authenticated", undefined, "terminal");
  }

  const { data: prestataire, error: prestataireError } =
    await params.supabaseUser
      .from("prestataire")
      .select("id, stripe_account_id, stripe_connect_operation_key")
      .eq("user_id", authData.user.id)
      .single();

  if (prestataireError || !prestataire) {
    throw new StripeDomainError(
      "stripe_prestataire_lookup_failed",
      undefined,
      "retryable",
    );
  }

  if (!prestataire.stripe_account_id) {
    return { ...NOT_CONFIGURED_VIEW };
  }

  const sidianEnvironment =
    params.sidianEnvironment ?? getSidianEnvironment();
  const retrieved = await retrieveConnectedAccount(
    prestataire.stripe_account_id,
    params.stripe,
  );
  const account = assertConnectedAccountIdentity({
    account: retrieved,
    expectedAccountId: prestataire.stripe_account_id,
    prestataireId: prestataire.id,
    operationKey: prestataire.stripe_connect_operation_key,
    sidianEnvironment,
  });
  const projection = await syncConnectedAccountProjection({
    supabase: params.supabaseAdmin,
    prestataireId: prestataire.id,
    account,
  });
  const cardPaymentsStatus = capabilityView(
    account.capabilities?.card_payments,
  );
  const sepaDebitPaymentsStatus = capabilityView(
    account.capabilities?.sepa_debit_payments,
  );
  const paymentsRestricted =
    Boolean(projection.disabledReason) || projection.pastDue.length > 0;

  return {
    configured: true,
    onboardingStatus: projection.onboardingStatus,
    chargesEnabled: projection.chargesEnabled,
    payoutsEnabled: projection.payoutsEnabled,
    cardPaymentsStatus,
    sepaDebitPaymentsStatus,
    currentlyDueCount: projection.currentlyDue.length,
    pendingVerificationCount: projection.pendingVerification.length,
    pastDueCount: projection.pastDue.length,
    canOpenOnboarding: shouldOpenConnectedAccountOnboarding(account),
    requiredRailsActive:
      projection.chargesEnabled &&
      !paymentsRestricted &&
      cardPaymentsStatus === "active" &&
      sepaDebitPaymentsStatus === "active",
  };
}

/** Fonction pure utile aux tests et aux écrans déjà alimentés par un Account. */
export function projectStripeConnectAccountView(
  account: Stripe.Account,
): StripeConnectAccountView {
  const projection = projectAccountStatus(account);
  const cardPaymentsStatus = capabilityView(
    account.capabilities?.card_payments,
  );
  const sepaDebitPaymentsStatus = capabilityView(
    account.capabilities?.sepa_debit_payments,
  );
  const paymentsRestricted =
    Boolean(projection.disabledReason) || projection.pastDue.length > 0;

  return {
    configured: true,
    onboardingStatus: projection.onboardingStatus,
    chargesEnabled: projection.chargesEnabled,
    payoutsEnabled: projection.payoutsEnabled,
    cardPaymentsStatus,
    sepaDebitPaymentsStatus,
    currentlyDueCount: projection.currentlyDue.length,
    pendingVerificationCount: projection.pendingVerification.length,
    pastDueCount: projection.pastDue.length,
    canOpenOnboarding: shouldOpenConnectedAccountOnboarding(account),
    requiredRailsActive:
      projection.chargesEnabled &&
      !paymentsRestricted &&
      cardPaymentsStatus === "active" &&
      sepaDebitPaymentsStatus === "active",
  };
}
