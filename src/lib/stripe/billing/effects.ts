import "server-only";

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import { StripeDomainError } from "@/lib/stripe/shared/errors";
import type { WebhookDispatchResult } from "@/lib/stripe/webhooks/dispatch";
import type { Database } from "@/types/database.generated";

type AdminClient = SupabaseClient<Database>;

function referenceId(
  value: string | { id?: string } | null | undefined,
): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (value && typeof value === "object" && typeof value.id === "string") {
    return value.id.trim() || null;
  }
  return null;
}

function unixToIso(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

/**
 * Fin de période courante. Depuis l'API 2026-06-24, `current_period_end` vit
 * sur les items d'abonnement, plus sur l'abonnement lui-même : on retient la
 * plus tardive, qui est la date jusqu'à laquelle l'accès est payé.
 */
function resolveCurrentPeriodEnd(
  subscription: Stripe.Subscription,
): string | null {
  const ends = (subscription.items?.data ?? [])
    .map((item) => item.current_period_end)
    .filter((value): value is number => typeof value === "number");
  if (ends.length === 0) return null;
  return unixToIso(Math.max(...ends));
}

function resolvePriceId(subscription: Stripe.Subscription): string | null {
  const first = subscription.items?.data?.[0];
  return referenceId(first?.price ?? null);
}

function assertPlatformScopedEvent(event: Stripe.Event): void {
  // Un événement de compte connecté ne doit JAMAIS emprunter le chemin
  // facturation : l'abonnement Sidian vit uniquement sur le compte plateforme.
  if (typeof event.account === "string" && event.account.trim() !== "") {
    throw new StripeDomainError(
      "sidian_billing_connected_event_rejected",
      undefined,
      "terminal",
    );
  }
}

function mapRpcOutcome(
  data: unknown,
  processedDetail: string,
): WebhookDispatchResult {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new StripeDomainError(
      "sidian_billing_rpc_response_invalid",
      undefined,
      "retryable",
    );
  }
  const payload = data as { applied?: unknown; reason?: unknown };
  if (payload.applied === true) {
    return { outcome: "processed", detail: processedDetail };
  }
  const reason =
    typeof payload.reason === "string" ? payload.reason : "not_applied";
  // « déjà appliqué » et « pas de binding » sont des issues normales et
  // terminales : rejouer l'événement ne changerait rien.
  return { outcome: "ignored", reason };
}

function throwRpcError(error: { message?: string } | null, fallback: string): never {
  const message = error?.message ?? "";
  // Les violations d'identité sont des erreurs de configuration, pas des
  // incidents transitoires : ne pas les rejouer indéfiniment.
  const terminal =
    message.includes("identity_mismatch") ||
    message.includes("unsupported") ||
    message.includes("required") ||
    message.includes("bound_elsewhere");
  throw new StripeDomainError(
    fallback,
    undefined,
    terminal ? "terminal" : "retryable",
  );
}

export async function handleSidianSubscriptionLifecycle(
  event: Stripe.Event,
  context: { supabase: AdminClient; earlyAccessLockMonths: number | null },
): Promise<WebhookDispatchResult> {
  assertPlatformScopedEvent(event);

  const subscription = event.data.object as Stripe.Subscription;
  if (!subscription || subscription.object !== "subscription") {
    throw new StripeDomainError(
      "sidian_billing_subscription_object_invalid",
      undefined,
      "terminal",
    );
  }

  const customerId = referenceId(subscription.customer);
  if (!customerId || !subscription.id) {
    throw new StripeDomainError(
      "sidian_billing_subscription_identity_missing",
      undefined,
      "terminal",
    );
  }

  const { data, error } = await context.supabase.rpc(
    "apply_sidian_subscription_event",
    {
      p_stripe_event_id: event.id,
      p_event_type: event.type,
      p_event_created_at: new Date(event.created * 1000).toISOString(),
      p_stripe_customer_id: customerId,
      p_stripe_subscription_id: subscription.id,
      p_stripe_status: subscription.status,
      // Les paramètres optionnels de la RPC portent un défaut SQL : `undefined`
      // les omet, `null` ne passerait pas le typage généré.
      p_stripe_price_id: resolvePriceId(subscription) ?? undefined,
      p_current_period_end: resolveCurrentPeriodEnd(subscription) ?? undefined,
      p_cancel_at_period_end: subscription.cancel_at_period_end ?? false,
      p_early_access_lock_months: context.earlyAccessLockMonths ?? undefined,
    },
  );

  if (error) {
    throwRpcError(error, "sidian_billing_apply_event_failed");
  }

  return mapRpcOutcome(data, event.type);
}

export async function handleSidianInvoicePaymentFailed(
  event: Stripe.Event,
  context: { supabase: AdminClient },
): Promise<WebhookDispatchResult> {
  assertPlatformScopedEvent(event);

  const invoice = event.data.object as Stripe.Invoice;
  if (!invoice || invoice.object !== "invoice") {
    throw new StripeDomainError(
      "sidian_billing_invoice_object_invalid",
      undefined,
      "terminal",
    );
  }

  const customerId = referenceId(invoice.customer ?? null);
  if (!customerId || !invoice.id) {
    throw new StripeDomainError(
      "sidian_billing_invoice_identity_missing",
      undefined,
      "terminal",
    );
  }

  const subscriptionId = referenceId(
    invoice.parent?.subscription_details?.subscription ?? null,
  );
  if (!subscriptionId) {
    // Facture hors abonnement (paiement ponctuel) : hors périmètre.
    return { outcome: "ignored", reason: "invoice_not_subscription_scoped" };
  }

  const { data, error } = await context.supabase.rpc(
    "apply_sidian_subscription_payment_failure",
    {
      p_stripe_event_id: event.id,
      p_event_created_at: new Date(event.created * 1000).toISOString(),
      p_stripe_customer_id: customerId,
      p_stripe_invoice_id: invoice.id,
      p_stripe_subscription_id: subscriptionId,
    },
  );

  if (error) {
    throwRpcError(error, "sidian_billing_apply_payment_failure_failed");
  }

  return mapRpcOutcome(data, event.type);
}
