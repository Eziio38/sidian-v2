import type Stripe from "stripe";

export type ReconciliationHumanReason =
  | "account_identity_mismatch"
  | "customer_identity_mismatch"
  | "local_financial_state_mismatch"
  | "payment_intent_identity_mismatch"
  | "payment_intent_status_ambiguous"
  | "session_identity_mismatch"
  | "stripe_amount_mismatch"
  | "stripe_currency_mismatch"
  | "stripe_object_missing"
  | "stripe_projection_mismatch"
  | "too_many_attempts";

export type ReconciliationEffectType =
  | "checkout.session.completed"
  | "payment_intent.processing"
  | "payment_intent.succeeded";

export type ReconciliationObservation = {
  account_id: string;
  account_metadata_prestataire_id: string;
  account_metadata_environment: string;
  session_id: string;
  session_mode: string;
  session_status: string;
  session_payment_status: string;
  session_currency: string;
  session_amount_total: number;
  session_client_reference_id: string;
  session_metadata_tentative_id: string;
  session_metadata_creance_id: string;
  session_payment_intent_id: string;
  session_customer_id: string;
  payment_intent_id: string;
  payment_intent_status: string;
  payment_intent_currency: string;
  payment_intent_amount: number;
  payment_intent_amount_received: number;
  payment_intent_application_fee_amount: number;
  payment_intent_customer_id: string;
  payment_intent_metadata_tentative_id: string;
  payment_intent_metadata_creance_id: string;
  customer_id: string;
  customer_deleted: boolean;
  customer_metadata_prestataire_id: string;
  customer_metadata_client_payeur_id: string;
  customer_metadata_environment: string;
  moyen: "carte" | "sepa_core";
};

export type LocalReconciliationAttempt = {
  id: string;
  creanceId: string;
  prestataireId: string;
  clientPayeurId: string;
  stripeAccountId: string;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId: string | null;
  stripeCustomerId: string | null;
  amount: number;
  applicationFeeAmount: number;
  currency: string;
  source: "lien_agent" | "prelevement_auto";
  moyen: "carte" | "sepa_core" | null;
  state:
    | "CREEE"
    | "NECESSITE_ACTION_CLIENT"
    | "EN_TRAITEMENT"
    | "REUSSIE"
    | "ECHOUEE"
    | "ANNULEE";
  confirmedPayment:
    | { amount: number; source: "lien_agent" | "prelevement_auto" | "detecte_hors_sidian" }
    | null;
  sidianEnvironment: "local" | "staging" | "production";
};

export type LiveReconciliationObjects = {
  account: Stripe.Account;
  session: Stripe.Checkout.Session;
  paymentIntent: Stripe.PaymentIntent;
  customer: Stripe.Customer | Stripe.DeletedCustomer;
};

export type AttemptInspection =
  | {
      outcome: "safe";
      observation: ReconciliationObservation;
      effects: ReconciliationEffectType[];
    }
  | { outcome: "pending" }
  | { outcome: "human_required"; reason: ReconciliationHumanReason };

function objectId(
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

function chosenPaymentRail(
  paymentIntent: Stripe.PaymentIntent,
): "carte" | "sepa_core" | null {
  const latestCharge =
    paymentIntent.latest_charge &&
    typeof paymentIntent.latest_charge === "object"
      ? (paymentIntent.latest_charge as Stripe.Charge)
      : null;
  const type = latestCharge?.payment_method_details?.type;
  if (type === "card") return "carte";
  if (type === "sepa_debit") return "sepa_core";

  const types = paymentIntent.payment_method_types ?? [];
  if (types.length === 1 && types[0] === "card") return "carte";
  if (types.length === 1 && types[0] === "sepa_debit") return "sepa_core";
  return null;
}

function isPositiveSafeInteger(value: number | null | undefined): value is number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0;
}

/**
 * Compare une tentative locale avec quatre objets relus dans le même compte
 * Connect. Aucune branche ne "devine" une identité ou un état financier.
 */
export function inspectLivePaymentAttempt(params: {
  local: LocalReconciliationAttempt;
  live: LiveReconciliationObjects;
}): AttemptInspection {
  const { local, live } = params;
  const { account, session, paymentIntent, customer } = live;

  if (local.source !== "lien_agent") {
    return {
      outcome: "human_required",
      reason: "local_financial_state_mismatch",
    };
  }

  if (
    account.id !== local.stripeAccountId ||
    account.metadata?.sidian_prestataire_id !== local.prestataireId ||
    account.metadata?.sidian_environment !== local.sidianEnvironment
  ) {
    return { outcome: "human_required", reason: "account_identity_mismatch" };
  }

  if (
    session.object !== "checkout.session" ||
    session.id !== local.stripeCheckoutSessionId ||
    session.mode !== "payment" ||
    session.client_reference_id !== local.id ||
    session.metadata?.sidian_tentative_id !== local.id ||
    session.metadata?.sidian_creance_id !== local.creanceId
  ) {
    return { outcome: "human_required", reason: "session_identity_mismatch" };
  }
  if (
    local.currency !== "EUR" ||
    session.currency?.toLowerCase() !== "eur"
  ) {
    return { outcome: "human_required", reason: "stripe_currency_mismatch" };
  }
  if (
    !isPositiveSafeInteger(session.amount_total) ||
    session.amount_total !== local.amount
  ) {
    return { outcome: "human_required", reason: "stripe_amount_mismatch" };
  }

  const sessionPaymentIntentId = objectId(session.payment_intent);
  const sessionCustomerId = objectId(session.customer);
  if (!sessionPaymentIntentId || !sessionCustomerId) {
    return { outcome: "human_required", reason: "stripe_object_missing" };
  }

  if (
    paymentIntent.object !== "payment_intent" ||
    paymentIntent.id !== sessionPaymentIntentId ||
    (local.stripePaymentIntentId !== null &&
      local.stripePaymentIntentId !== paymentIntent.id) ||
    paymentIntent.metadata?.sidian_tentative_id !== local.id ||
    paymentIntent.metadata?.sidian_creance_id !== local.creanceId
  ) {
    return {
      outcome: "human_required",
      reason: "payment_intent_identity_mismatch",
    };
  }
  if (paymentIntent.currency?.toLowerCase() !== "eur") {
    return { outcome: "human_required", reason: "stripe_currency_mismatch" };
  }
  if (
    !isPositiveSafeInteger(paymentIntent.amount) ||
    paymentIntent.amount !== local.amount
  ) {
    return { outcome: "human_required", reason: "stripe_amount_mismatch" };
  }
  if (
    (paymentIntent.application_fee_amount ?? 0) !==
    local.applicationFeeAmount
  ) {
    return {
      outcome: "human_required",
      reason: "payment_intent_identity_mismatch",
    };
  }

  const paymentIntentCustomerId = objectId(paymentIntent.customer);
  const customerDeleted = "deleted" in customer && customer.deleted === true;
  if (
    customerDeleted ||
    customer.id !== sessionCustomerId ||
    paymentIntentCustomerId !== sessionCustomerId ||
    (local.stripeCustomerId !== null &&
      local.stripeCustomerId !== sessionCustomerId) ||
    customer.metadata?.sidian_prestataire_id !== local.prestataireId ||
    customer.metadata?.sidian_client_payeur_id !== local.clientPayeurId ||
    customer.metadata?.sidian_environment !== local.sidianEnvironment
  ) {
    return { outcome: "human_required", reason: "customer_identity_mismatch" };
  }

  const moyen = chosenPaymentRail(paymentIntent);
  if (!moyen || (local.moyen !== null && local.moyen !== moyen)) {
    return {
      outcome: "human_required",
      reason: "payment_intent_identity_mismatch",
    };
  }

  const observation: ReconciliationObservation = {
    account_id: account.id,
    account_metadata_prestataire_id:
      account.metadata.sidian_prestataire_id,
    account_metadata_environment: account.metadata.sidian_environment,
    session_id: session.id,
    session_mode: session.mode,
    session_status: session.status ?? "",
    session_payment_status: session.payment_status,
    session_currency: session.currency ?? "",
    session_amount_total: session.amount_total,
    session_client_reference_id: session.client_reference_id ?? "",
    session_metadata_tentative_id:
      session.metadata?.sidian_tentative_id ?? "",
    session_metadata_creance_id: session.metadata?.sidian_creance_id ?? "",
    session_payment_intent_id: sessionPaymentIntentId,
    session_customer_id: sessionCustomerId,
    payment_intent_id: paymentIntent.id,
    payment_intent_status: paymentIntent.status,
    payment_intent_currency: paymentIntent.currency,
    payment_intent_amount: paymentIntent.amount,
    payment_intent_amount_received: paymentIntent.amount_received,
    payment_intent_application_fee_amount:
      paymentIntent.application_fee_amount ?? 0,
    payment_intent_customer_id: paymentIntentCustomerId,
    payment_intent_metadata_tentative_id:
      paymentIntent.metadata?.sidian_tentative_id ?? "",
    payment_intent_metadata_creance_id:
      paymentIntent.metadata?.sidian_creance_id ?? "",
    customer_id: customer.id,
    customer_deleted: false,
    customer_metadata_prestataire_id:
      customer.metadata?.sidian_prestataire_id ?? "",
    customer_metadata_client_payeur_id:
      customer.metadata?.sidian_client_payeur_id ?? "",
    customer_metadata_environment:
      customer.metadata?.sidian_environment ?? "",
    moyen,
  };

  const effects: ReconciliationEffectType[] = [];
  if (
    local.stripePaymentIntentId === null ||
    local.stripeCustomerId === null
  ) {
    effects.push("checkout.session.completed");
  }

  if (paymentIntent.status === "succeeded") {
    if (
      session.status !== "complete" ||
      session.payment_status !== "paid" ||
      !isPositiveSafeInteger(paymentIntent.amount_received) ||
      paymentIntent.amount_received !== local.amount
    ) {
      return {
        outcome: "human_required",
        reason: "payment_intent_status_ambiguous",
      };
    }

    const confirmedPaymentMatches =
      local.confirmedPayment !== null &&
      local.confirmedPayment.amount === local.amount &&
      local.confirmedPayment.source === "lien_agent";
    if (local.state !== "REUSSIE" || !confirmedPaymentMatches) {
      effects.push("payment_intent.succeeded");
    }
    return { outcome: "safe", observation, effects };
  }

  if (paymentIntent.status === "processing") {
    if (
      session.status !== "complete" ||
      session.payment_status !== "unpaid" ||
      !["CREEE", "NECESSITE_ACTION_CLIENT", "EN_TRAITEMENT"].includes(
        local.state,
      )
    ) {
      return {
        outcome: "human_required",
        reason: "payment_intent_status_ambiguous",
      };
    }
    if (local.state !== "EN_TRAITEMENT") {
      effects.push("payment_intent.processing");
    }
    return { outcome: "safe", observation, effects };
  }

  const safelyPending =
    session.status === "open" &&
    session.payment_status === "unpaid" &&
    [
      "requires_payment_method",
      "requires_confirmation",
      "requires_action",
    ].includes(paymentIntent.status) &&
    ["CREEE", "NECESSITE_ACTION_CLIENT"].includes(local.state) &&
    local.confirmedPayment === null;

  if (safelyPending) {
    return { outcome: "pending" };
  }

  return {
    outcome: "human_required",
    reason: "local_financial_state_mismatch",
  };
}
