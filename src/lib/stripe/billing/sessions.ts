import "server-only";

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import { StripeDomainError, toSafeStripeError } from "@/lib/stripe/shared/errors";
import { getSidianBillingStripeClient } from "@/lib/stripe/billing/client";
import { getSidianBillingReadiness } from "@/lib/stripe/billing/env";
import {
  ensureSidianBillingCustomer,
  readSidianBillingBinding,
} from "@/lib/stripe/billing/customer";
import type { Database } from "@/types/database.generated";

type AdminClient = SupabaseClient<Database>;

/** Chemin de retour après Checkout / Portail. Pas de donnée personnelle en query. */
export const SIDIAN_BILLING_RETURN_PATH = "/app/parametres";

function assertSafeAppUrl(appUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(appUrl);
  } catch {
    throw new StripeDomainError(
      "sidian_billing_app_url_invalid",
      undefined,
      "terminal",
    );
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new StripeDomainError(
      "sidian_billing_app_url_invalid",
      undefined,
      "terminal",
    );
  }
  return parsed.origin;
}

/**
 * Crée la session Checkout de l'abonnement Sidian (mode subscription).
 *
 * Le prix vient exclusivement de STRIPE_BILLING_PRICE_ID : aucun montant n'est
 * codé côté application — le tarif commercial vit dans Stripe, pas dans le code.
 */
export async function createSidianSubscriptionCheckoutSession(params: {
  supabaseAdmin: AdminClient;
  prestataireId: string;
  email: string | null;
  nom: string | null;
  appUrl: string;
  stripe?: Stripe;
}): Promise<{ url: string; sessionId: string }> {
  const readiness = getSidianBillingReadiness();
  if (!readiness.enabled) {
    throw new StripeDomainError(
      "sidian_billing_not_configured",
      undefined,
      "terminal",
    );
  }
  const stripe = params.stripe ?? getSidianBillingStripeClient();
  const origin = assertSafeAppUrl(params.appUrl);

  const { customerId } = await ensureSidianBillingCustomer({
    supabaseAdmin: params.supabaseAdmin,
    prestataireId: params.prestataireId,
    email: params.email,
    nom: params.nom,
    stripe,
  });

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: readiness.priceId, quantity: 1 }],
      // client_reference_id et metadata servent au diagnostic ; le webhook
      // n'en dépend pas — il résout le prestataire par le Customer lié en base.
      client_reference_id: params.prestataireId,
      metadata: {
        sidian_prestataire_id: params.prestataireId,
        sidian_environment: readiness.environment,
        sidian_billing_scope: "subscription",
      },
      subscription_data: {
        metadata: {
          sidian_prestataire_id: params.prestataireId,
          sidian_environment: readiness.environment,
          sidian_billing_scope: "subscription",
        },
      },
      success_url: `${origin}${SIDIAN_BILLING_RETURN_PATH}?abonnement=succes`,
      cancel_url: `${origin}${SIDIAN_BILLING_RETURN_PATH}?abonnement=annule`,
    });
  } catch (error) {
    throw toSafeStripeError(error);
  }

  if (!session.url) {
    throw new StripeDomainError(
      "sidian_billing_checkout_url_missing",
      undefined,
      "retryable",
    );
  }

  return { url: session.url, sessionId: session.id };
}

/**
 * Crée un lien vers le Portail de facturation Stripe.
 *
 * Nécessite qu'une configuration de portail existe côté Stripe : si elle
 * manque, l'erreur Stripe est remontée telle quelle (normalisée) — on ne
 * fabrique aucun succès.
 */
export async function createSidianBillingPortalSession(params: {
  supabaseAdmin: AdminClient;
  prestataireId: string;
  appUrl: string;
  stripe?: Stripe;
}): Promise<{ url: string }> {
  const readiness = getSidianBillingReadiness();
  if (!readiness.enabled) {
    throw new StripeDomainError(
      "sidian_billing_not_configured",
      undefined,
      "terminal",
    );
  }
  const stripe = params.stripe ?? getSidianBillingStripeClient();
  const origin = assertSafeAppUrl(params.appUrl);

  const binding = await readSidianBillingBinding(
    params.supabaseAdmin,
    params.prestataireId,
  );
  if (!binding) {
    // Aucun abonnement n'a jamais été démarré : il n'y a rien à gérer.
    throw new StripeDomainError(
      "sidian_billing_no_customer",
      undefined,
      "terminal",
    );
  }

  let session: Stripe.BillingPortal.Session;
  try {
    session = await stripe.billingPortal.sessions.create({
      customer: binding.stripeCustomerId,
      return_url: `${origin}${SIDIAN_BILLING_RETURN_PATH}`,
    });
  } catch (error) {
    throw toSafeStripeError(error);
  }

  return { url: session.url };
}
