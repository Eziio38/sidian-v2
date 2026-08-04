import "server-only";

import type Stripe from "stripe";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  applyAccountUpdatedProjection,
  retrieveConnectedAccount,
} from "@/lib/stripe/connect/retrieve-and-sync";
import { assertConnectedScope } from "@/lib/stripe/shared/assert-connected-scope";
import { StripeDomainError } from "@/lib/stripe/shared/errors";
import {
  isKnownStripeWebhookEvent,
  type SidianStripeWebhookEventType,
} from "@/lib/stripe/webhooks/event-types";
import {
  handleChargeDisputeCreated,
  handleCheckoutSessionCompletedPayment,
  handleCheckoutSessionExpiredPayment,
  handlePaymentIntentPaymentFailed,
  handlePaymentIntentProcessing,
  handlePaymentIntentSucceeded,
} from "@/lib/stripe/webhooks/payment-effects";
import {
  handleCheckoutSessionCompletedSetup,
  handleCheckoutSessionExpiredSetup,
  handleMandateUpdatedAuthorization,
  handlePaymentMethodDetachedAuthorization,
  handleSetupIntentFailedAuthorization,
  handleSetupIntentSucceededAuthorization,
} from "@/lib/stripe/webhooks/authorization-effects";
import type { Database } from "@/types/database.generated";
import type { StripeWebhookLeaseIdentity } from "@/lib/stripe/webhooks/process";

type Db = Database;
type AdminClient = SupabaseClient<Db>;

export type WebhookDispatchResult =
  | { outcome: "processed"; detail?: string }
  | { outcome: "ignored"; reason: string }
  | { outcome: "failed"; code: string };

type Handler = (
  event: Stripe.Event,
  supabase: AdminClient,
  context: {
    stripe?: Stripe;
    sidianEnvironment: "local" | "staging" | "production";
    lease: StripeWebhookLeaseIdentity;
    renewLease: () => Promise<void>;
  },
) => Promise<WebhookDispatchResult>;

async function handleAccountUpdated(
  event: Stripe.Event,
  supabase: AdminClient,
  context: {
    stripe?: Stripe;
    sidianEnvironment: "local" | "staging" | "production";
    lease: StripeWebhookLeaseIdentity;
    renewLease: () => Promise<void>;
  },
): Promise<WebhookDispatchResult> {
  const account = event.data.object as Partial<Stripe.Account>;
  if (
    !account ||
    account.object !== "account" ||
    typeof account.id !== "string" ||
    !account.id
  ) {
    throw new StripeDomainError(
      "webhook_account_object_invalid",
      undefined,
      "terminal",
    );
  }
  if (typeof event.account !== "string") {
    throw new StripeDomainError(
      "stripe_connected_scope_mismatch",
      undefined,
      "terminal",
    );
  }
  const connectedAccountId = event.account;

  assertConnectedScope({
    expectedAccountId: connectedAccountId,
    actualAccountId: account.id,
    context: "account.updated",
  });

  const { data: prestataire, error } = await supabase
    .from("prestataire")
    .select("id, stripe_account_id")
    .eq("stripe_account_id", account.id)
    .maybeSingle();

  if (error) {
    throw new StripeDomainError("webhook_prestataire_lookup_failed");
  }

  if (!prestataire) {
    return {
      outcome: "ignored",
      reason: "no_prestataire_for_account",
    };
  }

  await context.renewLease();
  // Revérification live avant écriture de projection
  const live = await retrieveConnectedAccount(account.id, context.stripe);
  assertConnectedScope({
    expectedAccountId: prestataire.stripe_account_id,
    actualAccountId: live.id,
    context: "account.updated.live",
  });
  if (live.metadata?.sidian_prestataire_id !== prestataire.id) {
    throw new StripeDomainError(
      "webhook_account_metadata_invalid",
      undefined,
      "terminal",
    );
  }
  if (live.metadata?.sidian_environment !== context.sidianEnvironment) {
    throw new StripeDomainError(
      "webhook_account_environment_mismatch",
      undefined,
      "terminal",
    );
  }

  await context.renewLease();
  await applyAccountUpdatedProjection({
    supabase,
    stripeEventId: event.id,
    processingAttempt: context.lease.attempt,
    leaseToken: context.lease.leaseToken,
    stripeObjectId: account.id,
    prestataireId: prestataire.id,
    account: live,
  });

  return { outcome: "processed", detail: "projection_synced" };
}

// Adapte un effet du chemin paiement (event, {supabase, lease}) à la signature Handler.
function paymentEffect(
  effect: (
    event: Stripe.Event,
    context: { supabase: AdminClient; lease: StripeWebhookLeaseIdentity },
  ) => Promise<WebhookDispatchResult>,
): Handler {
  return (event, supabase, context) =>
    effect(event, { supabase, lease: context.lease });
}

const checkoutSessionCompleted: Handler = (event, supabase, context) => {
  const session = event.data.object as Stripe.Checkout.Session;
  return session.mode === "setup"
    ? handleCheckoutSessionCompletedSetup(event, {
        supabase,
        stripe: context.stripe,
        lease: context.lease,
        renewLease: context.renewLease,
      })
    : handleCheckoutSessionCompletedPayment(event, {
        supabase,
        lease: context.lease,
      });
};

const checkoutSessionExpired: Handler = (event, supabase, context) => {
  const session = event.data.object as Stripe.Checkout.Session;
  return session.mode === "setup"
    ? handleCheckoutSessionExpiredSetup(event, {
        supabase,
        stripe: context.stripe,
        lease: context.lease,
        renewLease: context.renewLease,
      })
    : handleCheckoutSessionExpiredPayment(event, {
        supabase,
        lease: context.lease,
      });
};

function authorizationEffect(
  effect: typeof handleSetupIntentSucceededAuthorization,
): Handler {
  return (event, supabase, context) =>
    effect(event, {
      supabase,
      stripe: context.stripe,
      lease: context.lease,
      renewLease: context.renewLease,
    });
}

const HANDLERS: Record<SidianStripeWebhookEventType, Handler> = {
  "account.updated": handleAccountUpdated,
  "checkout.session.completed": checkoutSessionCompleted,
  "checkout.session.expired": checkoutSessionExpired,
  "payment_intent.processing": paymentEffect(handlePaymentIntentProcessing),
  "payment_intent.succeeded": paymentEffect(handlePaymentIntentSucceeded),
  "payment_intent.payment_failed": paymentEffect(
    handlePaymentIntentPaymentFailed,
  ),
  "setup_intent.succeeded": authorizationEffect(
    handleSetupIntentSucceededAuthorization,
  ),
  "setup_intent.setup_failed": authorizationEffect(
    handleSetupIntentFailedAuthorization,
  ),
  "payment_method.detached": authorizationEffect(
    handlePaymentMethodDetachedAuthorization,
  ),
  "mandate.updated": authorizationEffect(handleMandateUpdatedAuthorization),
  "charge.dispute.created": paymentEffect(handleChargeDisputeCreated),
};

export async function dispatchStripeWebhookEvent(params: {
  event: Stripe.Event;
  supabaseAdmin: AdminClient;
  stripe?: Stripe;
  sidianEnvironment: "local" | "staging" | "production";
  lease: StripeWebhookLeaseIdentity;
  renewLease: () => Promise<void>;
}): Promise<WebhookDispatchResult> {
  const { event } = params;

  if (!isKnownStripeWebhookEvent(event.type)) {
    return { outcome: "ignored", reason: "unknown_event_type" };
  }

  return HANDLERS[event.type](
    event,
    params.supabaseAdmin,
    {
      stripe: params.stripe,
      sidianEnvironment: params.sidianEnvironment,
      lease: params.lease,
      renewLease: params.renewLease,
    },
  );
}
