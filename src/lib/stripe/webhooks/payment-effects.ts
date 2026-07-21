import "server-only";

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import { StripeDomainError } from "@/lib/stripe/shared/errors";
import type { Database } from "@/types/database.generated";
import type { StripeWebhookLeaseIdentity } from "@/lib/stripe/webhooks/process";
import type { WebhookDispatchResult } from "@/lib/stripe/webhooks/dispatch";

type AdminClient = SupabaseClient<Database>;
type Moyen = Database["public"]["Enums"]["tentative_paiement_moyen"];

export type PaymentEffectContext = {
  supabase: AdminClient;
  lease: StripeWebhookLeaseIdentity;
};

// Codes métier renvoyés par les RPC financières qui ne doivent jamais être
// rejoués (retrying ne les résoudra pas) → terminalisation contrôlée.
const TERMINAL_EFFECT_MARKERS = [
  "scope_mismatch",
  "tentative_unresolved",
  "object_mismatch",
  "amount_invalid",
  "currency_not_supported",
  "identity_mismatch",
];

function stringId(
  value: string | { id?: string | null } | null | undefined,
): string | undefined {
  if (typeof value === "string") return value.length > 0 ? value : undefined;
  if (value && typeof value === "object" && typeof value.id === "string") {
    return value.id;
  }
  return undefined;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tentativeIdFromMetadata(
  metadata: Stripe.Metadata | null | undefined,
): string | null {
  const candidate = metadata?.sidian_tentative_id;
  return typeof candidate === "string" && UUID_RE.test(candidate)
    ? candidate
    : null;
}

/** Le compte connecté de l'événement, refusé de façon terminale si absent. */
function requireConnectedAccount(event: Stripe.Event): string {
  if (typeof event.account !== "string" || event.account.length === 0) {
    throw new StripeDomainError(
      "stripe_connected_scope_mismatch",
      undefined,
      "terminal",
    );
  }
  return event.account;
}

/** Devise autoritative issue de l'objet Stripe, jamais du navigateur. */
function requireEurPaymentIntent(pi: Stripe.PaymentIntent): "eur" {
  if (pi.currency?.toLowerCase() !== "eur") {
    throw new StripeDomainError(
      "stripe_payment_currency_not_supported",
      undefined,
      "terminal",
    );
  }
  return "eur";
}

/** Déduit le moyen sans appel live ; null si ambigu (moyen reste coalescé). */
function deriveMoyen(pi: Stripe.PaymentIntent): Moyen | null {
  const charge =
    pi.latest_charge && typeof pi.latest_charge === "object"
      ? (pi.latest_charge as Stripe.Charge)
      : undefined;
  const chargeType = charge?.payment_method_details?.type;
  const types = pi.payment_method_types ?? [];
  const resolved =
    chargeType ?? (types.length === 1 ? types[0] : undefined);
  if (resolved === "card") return "carte";
  if (resolved === "sepa_debit") return "sepa_core";
  return null;
}

async function callEffect(
  context: PaymentEffectContext,
  rpc: Parameters<AdminClient["rpc"]>[0],
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await context.supabase.rpc(
    rpc as never,
    args as never,
  );
  if (error) {
    const message = error.message ?? "";
    if (message.includes("webhook_lease_lost")) {
      throw new StripeDomainError(
        "webhook_lease_lost",
        undefined,
        "lease_lost",
      );
    }
    if (TERMINAL_EFFECT_MARKERS.some((marker) => message.includes(marker))) {
      throw new StripeDomainError(
        "stripe_financial_effect_rejected",
        message,
        "terminal",
      );
    }
    throw new StripeDomainError(
      "stripe_financial_effect_failed",
      message,
      "retryable",
    );
  }
  return (data ?? {}) as Record<string, unknown>;
}

export async function handleCheckoutSessionCompletedPayment(
  event: Stripe.Event,
  context: PaymentEffectContext,
): Promise<WebhookDispatchResult> {
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.mode !== "payment") {
    return { outcome: "ignored", reason: "deferred_to_authorization_lot" };
  }
  const account = requireConnectedAccount(event);
  await callEffect(context, "apply_checkout_session_completed_payment", {
    p_stripe_event_id: context.lease.eventId,
    p_processing_attempt: context.lease.attempt,
    p_lease_token: context.lease.leaseToken,
    p_connected_account_id: account,
    p_checkout_session_id: session.id,
    p_payment_intent_id: stringId(session.payment_intent) ?? null,
    p_customer_id: stringId(session.customer) ?? null,
  });
  return { outcome: "processed", detail: "checkout_session_completed_payment" };
}

export async function handleCheckoutSessionExpiredPayment(
  event: Stripe.Event,
  context: PaymentEffectContext,
): Promise<WebhookDispatchResult> {
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.mode !== "payment") {
    return { outcome: "ignored", reason: "deferred_to_authorization_lot" };
  }
  const account = requireConnectedAccount(event);
  await callEffect(context, "apply_checkout_session_expired_payment", {
    p_stripe_event_id: context.lease.eventId,
    p_processing_attempt: context.lease.attempt,
    p_lease_token: context.lease.leaseToken,
    p_connected_account_id: account,
    p_checkout_session_id: session.id,
  });
  return { outcome: "processed", detail: "checkout_session_expired_payment" };
}

export async function handlePaymentIntentProcessing(
  event: Stripe.Event,
  context: PaymentEffectContext,
): Promise<WebhookDispatchResult> {
  const pi = event.data.object as Stripe.PaymentIntent;
  const account = requireConnectedAccount(event);
  requireEurPaymentIntent(pi);
  await callEffect(context, "apply_payment_intent_processing", {
    p_stripe_event_id: context.lease.eventId,
    p_processing_attempt: context.lease.attempt,
    p_lease_token: context.lease.leaseToken,
    p_connected_account_id: account,
    p_payment_intent_id: pi.id,
    p_tentative_id: tentativeIdFromMetadata(pi.metadata),
    p_moyen: deriveMoyen(pi),
  });
  return { outcome: "processed", detail: "payment_intent_processing" };
}

export async function handlePaymentIntentSucceeded(
  event: Stripe.Event,
  context: PaymentEffectContext,
): Promise<WebhookDispatchResult> {
  const pi = event.data.object as Stripe.PaymentIntent;
  const account = requireConnectedAccount(event);
  const currency = requireEurPaymentIntent(pi);
  const amountReceived =
    typeof pi.amount_received === "number" && pi.amount_received > 0
      ? pi.amount_received
      : pi.amount;
  await callEffect(context, "apply_eur_payment_intent_succeeded", {
    p_stripe_event_id: context.lease.eventId,
    p_processing_attempt: context.lease.attempt,
    p_lease_token: context.lease.leaseToken,
    p_connected_account_id: account,
    p_payment_intent_id: pi.id,
    p_tentative_id: tentativeIdFromMetadata(pi.metadata),
    p_amount_received: amountReceived,
    p_currency: currency,
    p_moyen: deriveMoyen(pi),
  });
  return { outcome: "processed", detail: "payment_intent_succeeded" };
}

export async function handlePaymentIntentPaymentFailed(
  event: Stripe.Event,
  context: PaymentEffectContext,
): Promise<WebhookDispatchResult> {
  const pi = event.data.object as Stripe.PaymentIntent;
  const account = requireConnectedAccount(event);
  requireEurPaymentIntent(pi);
  const failure = pi.last_payment_error;
  await callEffect(context, "apply_payment_intent_payment_failed", {
    p_stripe_event_id: context.lease.eventId,
    p_processing_attempt: context.lease.attempt,
    p_lease_token: context.lease.leaseToken,
    p_connected_account_id: account,
    p_payment_intent_id: pi.id,
    p_tentative_id: tentativeIdFromMetadata(pi.metadata),
    p_echec_code: failure?.code ?? failure?.decline_code ?? "payment_failed",
    p_echec_message: failure?.message ?? null,
  });
  return { outcome: "processed", detail: "payment_intent_payment_failed" };
}

export async function handleChargeDisputeCreated(
  event: Stripe.Event,
  context: PaymentEffectContext,
): Promise<WebhookDispatchResult> {
  const dispute = event.data.object as Stripe.Dispute;
  const account = requireConnectedAccount(event);
  await callEffect(context, "record_charge_dispute_opened", {
    p_stripe_event_id: context.lease.eventId,
    p_processing_attempt: context.lease.attempt,
    p_lease_token: context.lease.leaseToken,
    p_connected_account_id: account,
    p_dispute_id: dispute.id,
    p_payment_intent_id: stringId(dispute.payment_intent) ?? null,
    p_reason: dispute.reason ?? null,
  });
  return { outcome: "processed", detail: "charge_dispute_created" };
}
