import "server-only";

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getStripeClient } from "@/lib/stripe/client";
import { FUTURE_PAYMENT_AUTHORIZATION_TEXT_VERSION } from "@/lib/stripe/authorizations/consent";
import { StripeDomainError } from "@/lib/stripe/shared/errors";
import type { Database } from "@/types/database.generated";

import type { WebhookDispatchResult } from "./dispatch";
import type { StripeWebhookLeaseIdentity } from "./process";

type AdminClient = SupabaseClient<Database>;

export type AuthorizationEffectContext = {
  supabase: AdminClient;
  stripe?: Stripe;
  lease: StripeWebhookLeaseIdentity;
  renewLease: () => Promise<void>;
};

const TERMINAL_MARKERS = [
  "scope_mismatch",
  "unresolved",
  "object_mismatch",
  "object_invalid",
  "rail_invalid",
  "mandate_invalid",
  "mandate_status_invalid",
  "not_configurable",
];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stringId(
  value: string | { id?: string | null } | null | undefined,
): string | undefined {
  if (typeof value === "string") return value || undefined;
  return value && typeof value.id === "string" ? value.id : undefined;
}

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

function authorizationIdFromMetadata(
  metadata: Stripe.Metadata | null | undefined,
): string | null {
  const candidate = metadata?.sidian_payment_authorization_id;
  return typeof candidate === "string" && UUID_RE.test(candidate)
    ? candidate
    : null;
}

function authorizationTextVersionFromMetadata(
  metadata: Stripe.Metadata | null | undefined,
): string | null {
  const candidate = metadata?.sidian_authorization_text_version;
  return candidate === FUTURE_PAYMENT_AUTHORIZATION_TEXT_VERSION
    ? candidate
    : null;
}

async function callEffect<
  Name extends
    | "apply_checkout_session_completed_setup"
    | "apply_checkout_session_expired_setup"
    | "apply_setup_intent_succeeded_authorization"
    | "apply_setup_intent_failed_authorization"
    | "apply_payment_method_detached_authorization"
    | "apply_mandate_updated_authorization",
>(
  context: AuthorizationEffectContext,
  rpc: Name,
  args: Database["public"]["Functions"][Name]["Args"],
): Promise<Record<string, unknown>> {
  const { data, error } = await context.supabase.rpc(rpc, args);
  if (error) {
    const message = error.message ?? "";
    if (message.includes("webhook_lease_lost")) {
      throw new StripeDomainError(
        "webhook_lease_lost",
        undefined,
        "lease_lost",
      );
    }
    if (TERMINAL_MARKERS.some((marker) => message.includes(marker))) {
      throw new StripeDomainError(
        "stripe_authorization_effect_rejected",
        undefined,
        "terminal",
      );
    }
    throw new StripeDomainError(
      "stripe_authorization_effect_failed",
      undefined,
      "retryable",
    );
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {};
  }
  return data as Record<string, unknown>;
}

export async function handleCheckoutSessionCompletedSetup(
  event: Stripe.Event,
  context: AuthorizationEffectContext,
): Promise<WebhookDispatchResult> {
  const session = event.data.object as Stripe.Checkout.Session;
  const account = requireConnectedAccount(event);
  const setupIntentId = stringId(session.setup_intent);
  const customerId = stringId(session.customer);
  if (
    session.object !== "checkout.session" ||
    session.mode !== "setup" ||
    !setupIntentId ||
    !customerId
  ) {
    throw new StripeDomainError(
      "setup_authorization_object_invalid",
      undefined,
      "terminal",
    );
  }
  await callEffect(context, "apply_checkout_session_completed_setup", {
    p_stripe_event_id: context.lease.eventId,
    p_processing_attempt: context.lease.attempt,
    p_lease_token: context.lease.leaseToken,
    p_connected_account_id: account,
    p_checkout_session_id: session.id,
    p_setup_intent_id: setupIntentId,
    p_customer_id: customerId,
  });
  return { outcome: "processed", detail: "checkout_session_completed_setup" };
}

export async function handleCheckoutSessionExpiredSetup(
  event: Stripe.Event,
  context: AuthorizationEffectContext,
): Promise<WebhookDispatchResult> {
  const session = event.data.object as Stripe.Checkout.Session;
  const account = requireConnectedAccount(event);
  if (session.object !== "checkout.session" || session.mode !== "setup") {
    throw new StripeDomainError(
      "setup_authorization_object_invalid",
      undefined,
      "terminal",
    );
  }
  await callEffect(context, "apply_checkout_session_expired_setup", {
    p_stripe_event_id: context.lease.eventId,
    p_processing_attempt: context.lease.attempt,
    p_lease_token: context.lease.leaseToken,
    p_connected_account_id: account,
    p_checkout_session_id: session.id,
  });
  return { outcome: "processed", detail: "checkout_session_expired_setup" };
}

export async function handleSetupIntentSucceededAuthorization(
  event: Stripe.Event,
  context: AuthorizationEffectContext,
): Promise<WebhookDispatchResult> {
  const setupIntent = event.data.object as Stripe.SetupIntent;
  const account = requireConnectedAccount(event);
  const customerId = stringId(setupIntent.customer);
  const paymentMethodId = stringId(setupIntent.payment_method);
  const authorizationId = authorizationIdFromMetadata(setupIntent.metadata);
  const authorizationTextVersion = authorizationTextVersionFromMetadata(
    setupIntent.metadata,
  );
  if (
    setupIntent.object !== "setup_intent" ||
    setupIntent.status !== "succeeded" ||
    setupIntent.usage !== "off_session" ||
    !customerId ||
    !paymentMethodId ||
    !authorizationId ||
    !authorizationTextVersion
  ) {
    throw new StripeDomainError(
      "setup_authorization_object_invalid",
      undefined,
      "terminal",
    );
  }

  const stripe = context.stripe ?? getStripeClient();
  await context.renewLease();
  const paymentMethod = await stripe.paymentMethods.retrieve(
    paymentMethodId,
    {},
    { stripeAccount: account },
  );
  if (
    paymentMethod.id !== paymentMethodId ||
    stringId(paymentMethod.customer) !== customerId ||
    !["card", "sepa_debit"].includes(paymentMethod.type)
  ) {
    throw new StripeDomainError(
      "setup_authorization_object_mismatch",
      undefined,
      "terminal",
    );
  }

  let mandateId: string | null = null;
  let mandateStatus: Stripe.Mandate.Status | null = null;
  if (paymentMethod.type === "sepa_debit") {
    mandateId = stringId(setupIntent.mandate) ?? null;
    if (!mandateId) {
      throw new StripeDomainError(
        "setup_authorization_mandate_invalid",
        undefined,
        "terminal",
      );
    }
    await context.renewLease();
    const mandate = await stripe.mandates.retrieve(
      mandateId,
      {},
      { stripeAccount: account },
    );
    if (
      mandate.id !== mandateId ||
      mandate.type !== "multi_use" ||
      mandate.status !== "active" ||
      stringId(mandate.payment_method) !== paymentMethodId
    ) {
      throw new StripeDomainError(
        "setup_authorization_mandate_invalid",
        undefined,
        "terminal",
      );
    }
    mandateStatus = mandate.status;
  }

  await context.renewLease();
  await callEffect(context, "apply_setup_intent_succeeded_authorization", {
    p_stripe_event_id: context.lease.eventId,
    p_processing_attempt: context.lease.attempt,
    p_lease_token: context.lease.leaseToken,
    p_connected_account_id: account,
    p_setup_intent_id: setupIntent.id,
    p_authorization_id: authorizationId,
    p_authorization_text_version: authorizationTextVersion,
    p_customer_id: customerId,
    p_payment_method_id: paymentMethodId,
    p_payment_method_type: paymentMethod.type,
    p_mandate_id: mandateId,
    p_mandate_status: mandateStatus,
  });
  return { outcome: "processed", detail: "setup_intent_succeeded" };
}

export async function handleSetupIntentFailedAuthorization(
  event: Stripe.Event,
  context: AuthorizationEffectContext,
): Promise<WebhookDispatchResult> {
  const setupIntent = event.data.object as Stripe.SetupIntent;
  const account = requireConnectedAccount(event);
  const customerId = stringId(setupIntent.customer);
  const authorizationId = authorizationIdFromMetadata(setupIntent.metadata);
  const authorizationTextVersion = authorizationTextVersionFromMetadata(
    setupIntent.metadata,
  );
  if (
    setupIntent.object !== "setup_intent" ||
    !customerId ||
    !authorizationId ||
    !authorizationTextVersion
  ) {
    throw new StripeDomainError(
      "setup_authorization_object_invalid",
      undefined,
      "terminal",
    );
  }
  await callEffect(context, "apply_setup_intent_failed_authorization", {
    p_stripe_event_id: context.lease.eventId,
    p_processing_attempt: context.lease.attempt,
    p_lease_token: context.lease.leaseToken,
    p_connected_account_id: account,
    p_setup_intent_id: setupIntent.id,
    p_authorization_id: authorizationId,
    p_authorization_text_version: authorizationTextVersion,
    p_customer_id: customerId,
    p_failure_code: setupIntent.last_setup_error?.code ?? "setup_failed",
  });
  return { outcome: "processed", detail: "setup_intent_failed" };
}

export async function handlePaymentMethodDetachedAuthorization(
  event: Stripe.Event,
  context: AuthorizationEffectContext,
): Promise<WebhookDispatchResult> {
  const paymentMethod = event.data.object as Stripe.PaymentMethod;
  const account = requireConnectedAccount(event);
  if (paymentMethod.object !== "payment_method" || !paymentMethod.id) {
    throw new StripeDomainError(
      "setup_authorization_object_invalid",
      undefined,
      "terminal",
    );
  }
  await callEffect(context, "apply_payment_method_detached_authorization", {
    p_stripe_event_id: context.lease.eventId,
    p_processing_attempt: context.lease.attempt,
    p_lease_token: context.lease.leaseToken,
    p_connected_account_id: account,
    p_payment_method_id: paymentMethod.id,
  });
  return { outcome: "processed", detail: "payment_method_detached" };
}

export async function handleMandateUpdatedAuthorization(
  event: Stripe.Event,
  context: AuthorizationEffectContext,
): Promise<WebhookDispatchResult> {
  const mandate = event.data.object as Stripe.Mandate;
  const account = requireConnectedAccount(event);
  const paymentMethodId = stringId(mandate.payment_method);
  if (
    mandate.object !== "mandate" ||
    !paymentMethodId ||
    !["active", "pending", "inactive"].includes(mandate.status)
  ) {
    throw new StripeDomainError(
      "setup_authorization_object_invalid",
      undefined,
      "terminal",
    );
  }

  // Une réactivation exige une revérification live du moyen et du Customer ;
  // un simple changement de champ reçu hors scope ne suffit jamais.
  const stripe = context.stripe ?? getStripeClient();
  await context.renewLease();
  const paymentMethod = await stripe.paymentMethods.retrieve(
    paymentMethodId,
    {},
    { stripeAccount: account },
  );
  const customerId = stringId(paymentMethod.customer);
  if (
    paymentMethod.id !== paymentMethodId ||
    paymentMethod.type !== "sepa_debit" ||
    !customerId
  ) {
    throw new StripeDomainError(
      "setup_authorization_object_mismatch",
      undefined,
      "terminal",
    );
  }

  await context.renewLease();
  await callEffect(context, "apply_mandate_updated_authorization", {
    p_stripe_event_id: context.lease.eventId,
    p_processing_attempt: context.lease.attempt,
    p_lease_token: context.lease.leaseToken,
    p_connected_account_id: account,
    p_mandate_id: mandate.id,
    p_mandate_status: mandate.status,
    p_payment_method_id: paymentMethodId,
    p_customer_id: customerId,
  });
  return { outcome: "processed", detail: "mandate_updated" };
}
