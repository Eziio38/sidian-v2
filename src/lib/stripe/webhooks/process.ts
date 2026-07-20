import "server-only";

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSidianEnvironment } from "@/config/env-server";
import { getStripeClient, getStripeWebhookSecret } from "@/lib/stripe/client";
import {
  classifyStripeFailure,
  StripeDomainError,
  toSafeStripeError,
} from "@/lib/stripe/shared/errors";
import { dispatchStripeWebhookEvent } from "@/lib/stripe/webhooks/dispatch";
import type { Database } from "@/types/database.generated";

type Db = Database;

export const STRIPE_WEBHOOK_LEASE_SECONDS = 60;
export const STRIPE_WEBHOOK_MAX_ATTEMPTS = 8;

type ClaimResult = {
  claimed: boolean;
  status: string;
  terminal: boolean;
  attempt?: number;
  lease_token?: string;
};

export type StripeWebhookLeaseIdentity = {
  eventId: string;
  leaseToken: string;
  attempt: number;
};

function assertClaimIdentity(
  claim: ClaimResult,
  eventId: string,
): StripeWebhookLeaseIdentity {
  if (
    !claim.claimed ||
    !claim.lease_token ||
    !claim.attempt ||
    claim.attempt < 1
  ) {
    throw new StripeDomainError(
      "stripe_webhook_claim_identity_invalid",
      undefined,
      "terminal",
    );
  }
  return {
    eventId,
    leaseToken: claim.lease_token,
    attempt: claim.attempt,
  };
}

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
  supabase: SupabaseClient<Db>,
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

export async function renewStripeWebhookLease(
  supabase: SupabaseClient<Db>,
  lease: StripeWebhookLeaseIdentity,
): Promise<void> {
  const { data, error } = await supabase.rpc(
    "renew_stripe_webhook_event_lease",
    {
      p_event_id: lease.eventId,
      p_lease_token: lease.leaseToken,
      p_attempt: lease.attempt,
      p_lease_seconds: STRIPE_WEBHOOK_LEASE_SECONDS,
    },
  );
  if (error || !data) throwStatusPersistenceError(error);
}

export async function processStripeWebhookRequest(params: {
  rawBody: string | Buffer;
  signatureHeader: string | null;
  supabaseAdmin: SupabaseClient<Db>;
  stripe?: Stripe;
  webhookSecret?: string;
  sidianEnvironment?: "local" | "staging" | "production";
}): Promise<{
  httpStatus: number;
  body: { received: boolean; duplicate?: boolean; retryable?: boolean };
}> {
  if (!params.signatureHeader) {
    throw new StripeDomainError(
      "stripe_webhook_signature_missing",
      undefined,
      "terminal",
    );
  }
  const stripe = params.stripe ?? getStripeClient();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      params.rawBody,
      params.signatureHeader,
      params.webhookSecret ?? getStripeWebhookSecret(),
    );
  } catch (error) {
    throw toSafeStripeError(error);
  }

  const { data, error } = await params.supabaseAdmin.rpc(
    "claim_stripe_webhook_event",
    {
      p_event_id: event.id,
      p_type: event.type,
      p_stripe_connected_account_id:
        typeof event.account === "string" ? event.account : undefined,
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

  const lease = assertClaimIdentity(claim, event.id);
  let result;
  try {
    result = await dispatchStripeWebhookEvent({
      event,
      supabaseAdmin: params.supabaseAdmin,
      stripe,
      sidianEnvironment: params.sidianEnvironment ?? getSidianEnvironment(),
      lease,
      renewLease: () => renewStripeWebhookLease(params.supabaseAdmin, lease),
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
