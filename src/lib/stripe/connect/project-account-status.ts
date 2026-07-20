import "server-only";

import type Stripe from "stripe";

/**
 * Mapping Account Stripe → projection locale normalisée (doc 03 §1 / 02 §2bis).
 *
 * Ordre de priorité documenté :
 * 1. charges_enabled → paiements_actives
 * 2. disabled_reason → paiements_indisponibles
 * 3. past_due non vide → action_requise
 * 4. currently_due non vide → informations_requises
 * 5. pending_verification non vide → verification_en_cours
 * 6. details_submitted ou exigences déjà vues → configuration_commencee
 * 7. sinon → non_commence
 *
 * La projection n'autorise jamais une décision financière seule.
 */
export type StripeOnboardingStatus =
  | "non_commence"
  | "configuration_commencee"
  | "informations_requises"
  | "verification_en_cours"
  | "paiements_actives"
  | "paiements_indisponibles"
  | "action_requise";

export type ConnectedAccountProjection = {
  stripeAccountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  sepaDebitPaymentsStatus: StripeCapabilityStatus;
  onboardingStatus: StripeOnboardingStatus;
  currentlyDue: string[];
  pendingVerification: string[];
  pastDue: string[];
  disabledReason: string | null;
};

export type StripeCapabilityStatus = "inactive" | "pending" | "active";

function asStringList(value: string[] | null | undefined): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

export function projectAccountStatus(
  account: Pick<
    Stripe.Account,
    "id" | "charges_enabled" | "payouts_enabled" | "details_submitted" | "requirements" | "capabilities"
  >,
): ConnectedAccountProjection {
  const currentlyDue = asStringList(account.requirements?.currently_due);
  const pendingVerification = asStringList(
    account.requirements?.pending_verification,
  );
  const pastDue = asStringList(account.requirements?.past_due);
  const disabledReason = account.requirements?.disabled_reason ?? null;
  const chargesEnabled = account.charges_enabled === true;
  const payoutsEnabled = account.payouts_enabled === true;
  const detailsSubmitted = account.details_submitted === true;
  const sepaDebitPaymentsStatus =
    account.capabilities?.sepa_debit_payments === "active"
      ? "active"
      : account.capabilities?.sepa_debit_payments === "pending"
        ? "pending"
        : "inactive";

  let onboardingStatus: StripeOnboardingStatus;

  if (chargesEnabled) {
    onboardingStatus = "paiements_actives";
  } else if (disabledReason) {
    onboardingStatus = "paiements_indisponibles";
  } else if (pastDue.length > 0) {
    onboardingStatus = "action_requise";
  } else if (currentlyDue.length > 0) {
    onboardingStatus = "informations_requises";
  } else if (pendingVerification.length > 0) {
    onboardingStatus = "verification_en_cours";
  } else if (detailsSubmitted) {
    onboardingStatus = "configuration_commencee";
  } else {
    onboardingStatus = "non_commence";
  }

  return {
    stripeAccountId: account.id,
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted,
    sepaDebitPaymentsStatus,
    onboardingStatus,
    currentlyDue,
    pendingVerification,
    pastDue,
    disabledReason,
  };
}
