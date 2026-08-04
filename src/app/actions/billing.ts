"use server";

import { getPublicEnv } from "@/config/env-public";
import { requireConfirmedUser } from "@/lib/auth/session";
import { logServerEvent } from "@/lib/observability/server-logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { StripeDomainError } from "@/lib/stripe/shared/errors";
import { getSidianBillingReadiness } from "@/lib/stripe/billing/env";
import {
  createSidianBillingPortalSession,
  createSidianSubscriptionCheckoutSession,
} from "@/lib/stripe/billing/sessions";
import {
  getCurrentSubscription,
  requireSubscriptionCapability,
  SubscriptionCapabilityError,
} from "@/lib/subscription/server";
import type { SubscriptionEntitlements } from "@/lib/subscription/entitlements";

/**
 * Actions d'abonnement Sidian.
 *
 * Ce sont les seuls points d'entrée utilisateur du domaine facturation, et ils
 * sont gardés côté SERVEUR par `requireSubscriptionCapability` : masquer un
 * bouton dans l'UI ne protège rien.
 *
 * Aucune de ces actions n'écrit `subscription_status` — seul le webhook signé
 * le fait.
 */

export type BillingActionErrorCode =
  | "not_authenticated"
  | "billing_unavailable"
  | "already_subscribed"
  | "no_subscription"
  | "provider_unavailable";

export type BillingActionResult =
  | { ok: true; url: string }
  | { ok: false; code: BillingActionErrorCode; message: string };

const MESSAGES: Record<BillingActionErrorCode, string> = {
  not_authenticated: "Session introuvable. Reconnectez-vous.",
  billing_unavailable:
    "La gestion de l'abonnement n'est pas configurée sur cet environnement.",
  already_subscribed: "Un abonnement est déjà en cours sur ce compte.",
  no_subscription: "Aucun abonnement n'a encore été créé pour ce compte.",
  provider_unavailable:
    "Stripe n'a pas pu être joint. Réessayez dans un instant.",
};

function failure(code: BillingActionErrorCode): BillingActionResult {
  return { ok: false, code, message: MESSAGES[code] };
}

/**
 * Traduit un refus de droit en code d'erreur honnête : la cause exacte compte
 * (non configuré ≠ déjà abonné), sinon l'utilisateur ne sait pas quoi faire.
 */
function classifyDenial(
  error: SubscriptionCapabilityError,
): BillingActionResult {
  const entitlements: SubscriptionEntitlements | null = error.entitlements;
  if (!entitlements) return failure("not_authenticated");
  if (!entitlements.billingConfigured) return failure("billing_unavailable");
  if (error.capability === "billing_start_subscription") {
    return failure("already_subscribed");
  }
  return failure("no_subscription");
}

function classifyStripeDomainError(error: StripeDomainError): BillingActionResult {
  if (error.code === "sidian_billing_not_configured") {
    return failure("billing_unavailable");
  }
  if (error.code === "sidian_billing_no_customer") {
    return failure("no_subscription");
  }
  return failure("provider_unavailable");
}

/** État d'abonnement destiné à l'affichage. Jamais de secret, jamais d'id Stripe brut. */
export type BillingOverview = {
  state: SubscriptionEntitlements["state"];
  status: SubscriptionEntitlements["status"];
  billingConfigured: boolean;
  canStartSubscription: boolean;
  canManageSubscription: boolean;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export async function getBillingOverviewAction(): Promise<BillingOverview | null> {
  await requireConfirmedUser();
  const current = await getCurrentSubscription();
  if (!current) return null;

  const { entitlements } = current;
  return {
    state: entitlements.state,
    status: entitlements.status,
    billingConfigured: entitlements.billingConfigured,
    canStartSubscription: entitlements.capabilities.billing_start_subscription,
    canManageSubscription: entitlements.capabilities.billing_manage_subscription,
    currentPeriodEnd: entitlements.binding?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: entitlements.binding?.cancelAtPeriodEnd ?? false,
  };
}

export async function startSidianSubscriptionAction(): Promise<BillingActionResult> {
  await requireConfirmedUser();

  // Fail closed : sans configuration, on ne prétend pas pouvoir facturer.
  if (!getSidianBillingReadiness().enabled) {
    return failure("billing_unavailable");
  }

  let current;
  try {
    current = await requireSubscriptionCapability("billing_start_subscription");
  } catch (error) {
    if (error instanceof SubscriptionCapabilityError) {
      return classifyDenial(error);
    }
    throw error;
  }

  try {
    const supabaseAdmin = await createAdminClient();
    const session = await createSidianSubscriptionCheckoutSession({
      supabaseAdmin,
      prestataireId: current.prestataireId,
      email: current.email,
      nom: current.nom,
      appUrl: getPublicEnv().NEXT_PUBLIC_APP_URL,
    });
    return { ok: true, url: session.url };
  } catch (error) {
    logServerEvent("error", "billing.checkout_failed", {
      component: "stripe",
      errorCode:
        error instanceof StripeDomainError ? error.code : "billing_unexpected",
    });
    if (error instanceof StripeDomainError) {
      return classifyStripeDomainError(error);
    }
    return failure("provider_unavailable");
  }
}

export async function openSidianBillingPortalAction(): Promise<BillingActionResult> {
  await requireConfirmedUser();

  if (!getSidianBillingReadiness().enabled) {
    return failure("billing_unavailable");
  }

  let current;
  try {
    current = await requireSubscriptionCapability("billing_manage_subscription");
  } catch (error) {
    if (error instanceof SubscriptionCapabilityError) {
      return classifyDenial(error);
    }
    throw error;
  }

  try {
    const supabaseAdmin = await createAdminClient();
    const session = await createSidianBillingPortalSession({
      supabaseAdmin,
      prestataireId: current.prestataireId,
      appUrl: getPublicEnv().NEXT_PUBLIC_APP_URL,
    });
    return { ok: true, url: session.url };
  } catch (error) {
    logServerEvent("error", "billing.portal_failed", {
      component: "stripe",
      errorCode:
        error instanceof StripeDomainError ? error.code : "billing_unexpected",
    });
    if (error instanceof StripeDomainError) {
      return classifyStripeDomainError(error);
    }
    return failure("provider_unavailable");
  }
}
