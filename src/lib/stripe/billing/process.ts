import "server-only";

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  classifyStripeFailure,
  StripeDomainError,
} from "@/lib/stripe/shared/errors";
import type { WebhookDispatchResult } from "@/lib/stripe/webhooks/dispatch";
import {
  renewStripeWebhookLease,
  STRIPE_WEBHOOK_LEASE_SECONDS,
  STRIPE_WEBHOOK_MAX_ATTEMPTS,
  type StripeWebhookLeaseIdentity,
} from "@/lib/stripe/webhooks/process";
import { getSidianBillingStripeClient } from "@/lib/stripe/billing/client";
import { getSidianBillingReadiness } from "@/lib/stripe/billing/env";
import {
  handleSidianInvoicePaymentFailed,
  handleSidianSubscriptionLifecycle,
} from "@/lib/stripe/billing/effects";
import { isSidianBillingWebhookEvent } from "@/lib/stripe/billing/events";
import type { Database } from "@/types/database.generated";

type AdminClient = SupabaseClient<Database>;

/**
 * Traitement des webhooks de facturation.
 *
 * Réutilise INTÉGRALEMENT l'infrastructure existante (`processed_webhook_event`,
 * claim/lease/fencing, `stripe_webhook_effect`) : mêmes RPC, mêmes garanties de
 * rejeu. Seuls le secret de signature et la table d'effets métier diffèrent.
 * `markStatus` n'étant pas exporté par `@/lib/stripe/webhooks/process`, il est
 * re-enveloppé ici autour du MÊME RPC — pas d'un mécanisme parallèle.
 */

type ClaimResult = {
  claimed: boolean;
  status: string;
  terminal: boolean;
  attempt?: number;
  lease_token?: string;
};

function throwStatusPersistenceError(error: unknown): never {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  if (message.includes("webhook_lease_lost")) {
    throw new StripeDomainError("webhook_lease_lost", undefined, "lease_lost");
  }
  throw new StripeDomainError(
    "stripe_webhook_status_persistence_failed",
    undefined,
    "retryable",
  );
}

async function markStatus(
  supabase: AdminClient,
  lease: StripeWebhookLeaseIdentity,
  input: {
    status: "processed" | "ignored" | "failed_retryable" | "failed_terminal";
    errorCode?: string;
    retryDelaySeconds?: number;
  },
): Promise<void> {
  const { data, error } = await supabase.rpc("mark_stripe_webhook_event_status", {
    p_event_id: lease.eventId,
    p_lease_token: lease.leaseToken,
    p_attempt: lease.attempt,
    p_status: input.status,
    p_error_code: input.errorCode,
    p_retry_delay_seconds: input.retryDelaySeconds,
  });
  if (error || !data) throwStatusPersistenceError(error);
}

/**
 * Vérifie la signature avec le secret FACTURATION uniquement.
 * Retourne null si la signature ne correspond pas : l'appelant peut alors
 * tenter l'endpoint Connect. Aucun événement n'est accepté sans signature
 * valide pour le secret de son propre endpoint.
 */
export function tryVerifySidianBillingWebhookEvent(params: {
  rawBody: string | Buffer;
  signatureHeader: string | null;
  stripe?: Stripe;
  webhookSecret?: string;
}): Stripe.Event | null {
  if (!params.signatureHeader) return null;

  const readiness = getSidianBillingReadiness();
  const secret =
    params.webhookSecret ?? (readiness.enabled ? readiness.webhookSecret : null);
  if (!secret) return null;

  // Sans module actif ni client injecté, on ne fabrique pas de client Stripe :
  // pas de configuration, pas de vérification, pas d'événement accepté.
  const stripe =
    params.stripe ?? (readiness.enabled ? getSidianBillingStripeClient() : null);
  if (!stripe) return null;

  try {
    return stripe.webhooks.constructEvent(
      params.rawBody,
      params.signatureHeader,
      secret,
    );
  } catch {
    return null;
  }
}

export async function processSidianBillingWebhookEvent(params: {
  event: Stripe.Event;
  supabaseAdmin: AdminClient;
  earlyAccessLockMonths?: number | null;
}): Promise<{
  httpStatus: number;
  body: { received: boolean; duplicate?: boolean; retryable?: boolean };
}> {
  const { event } = params;

  const readiness = getSidianBillingReadiness();
  const earlyAccessLockMonths =
    params.earlyAccessLockMonths !== undefined
      ? params.earlyAccessLockMonths
      : readiness.enabled
        ? readiness.earlyAccessLockMonths
        : null;

  const { data, error } = await params.supabaseAdmin.rpc(
    "claim_stripe_webhook_event",
    {
      p_event_id: event.id,
      p_type: event.type,
      // Facturation = compte plateforme : jamais de compte connecté.
      p_stripe_connected_account_id: undefined,
      p_lease_seconds: STRIPE_WEBHOOK_LEASE_SECONDS,
      p_max_attempts: STRIPE_WEBHOOK_MAX_ATTEMPTS,
    },
  );
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    throw new StripeDomainError(
      "stripe_webhook_claim_failed",
      undefined,
      "retryable",
    );
  }

  const claim = data as ClaimResult;
  if (!claim.claimed) {
    if (claim.terminal) {
      return { httpStatus: 200, body: { received: true, duplicate: true } };
    }
    return {
      httpStatus: 503,
      body: { received: false, duplicate: true, retryable: true },
    };
  }
  if (!claim.lease_token || !claim.attempt || claim.attempt < 1) {
    throw new StripeDomainError(
      "stripe_webhook_claim_identity_invalid",
      undefined,
      "terminal",
    );
  }

  const lease: StripeWebhookLeaseIdentity = {
    eventId: event.id,
    leaseToken: claim.lease_token,
    attempt: claim.attempt,
  };

  let result: WebhookDispatchResult;
  try {
    // Renouvellement du lease avant l'écriture métier : même contrat que le
    // chemin Connect.
    await renewStripeWebhookLease(params.supabaseAdmin, lease);
    result =
      event.type === "invoice.payment_failed"
        ? await handleSidianInvoicePaymentFailed(event, {
            supabase: params.supabaseAdmin,
          })
        : await handleSidianSubscriptionLifecycle(event, {
            supabase: params.supabaseAdmin,
            earlyAccessLockMonths,
          });
  } catch (handlerError) {
    const failure = classifyStripeFailure(handlerError);
    if (failure.disposition === "lease_lost") throw handlerError;

    const retryable =
      failure.disposition === "retryable" &&
      lease.attempt < STRIPE_WEBHOOK_MAX_ATTEMPTS;
    await markStatus(params.supabaseAdmin, lease, {
      status: retryable ? "failed_retryable" : "failed_terminal",
      errorCode:
        retryable || failure.disposition === "terminal"
          ? failure.code
          : "webhook_max_attempts_exceeded",
      retryDelaySeconds: retryable
        ? Math.min(300, 2 ** Math.min(lease.attempt, 8))
        : undefined,
    });
    return retryable
      ? { httpStatus: 503, body: { received: false, retryable: true } }
      : { httpStatus: 200, body: { received: true } };
  }

  if (result.outcome === "processed") {
    await markStatus(params.supabaseAdmin, lease, { status: "processed" });
  } else if (result.outcome === "ignored") {
    await markStatus(params.supabaseAdmin, lease, {
      status: "ignored",
      errorCode: result.reason,
    });
  } else {
    await markStatus(params.supabaseAdmin, lease, {
      status: "failed_terminal",
      errorCode: result.code,
    });
  }

  return { httpStatus: 200, body: { received: true } };
}

/**
 * Point d'entrée du chemin facturation depuis la route webhook.
 * Retourne null si la requête n'est PAS un événement de facturation signé —
 * la route peut alors la proposer au chemin Connect.
 */
export async function tryProcessSidianBillingWebhookRequest(params: {
  rawBody: string | Buffer;
  signatureHeader: string | null;
  supabaseAdmin: AdminClient;
  stripe?: Stripe;
  webhookSecret?: string;
  earlyAccessLockMonths?: number | null;
}): Promise<{
  httpStatus: number;
  body: { received: boolean; duplicate?: boolean; retryable?: boolean };
} | null> {
  const event = tryVerifySidianBillingWebhookEvent({
    rawBody: params.rawBody,
    signatureHeader: params.signatureHeader,
    stripe: params.stripe,
    webhookSecret: params.webhookSecret,
  });
  if (!event) return null;

  if (!isSidianBillingWebhookEvent(event.type)) {
    // Signature de facturation valide mais type hors périmètre : acquitté sans
    // effet, jamais renvoyé au chemin Connect (mauvais secret, mauvais flux).
    return { httpStatus: 200, body: { received: true } };
  }

  return processSidianBillingWebhookEvent({
    event,
    supabaseAdmin: params.supabaseAdmin,
    earlyAccessLockMonths: params.earlyAccessLockMonths,
  });
}
