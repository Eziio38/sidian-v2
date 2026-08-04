import "server-only";

import Stripe from "stripe";

import { SIDIAN_STRIPE_API_VERSION } from "@/lib/stripe/client";
import { StripeDomainError } from "@/lib/stripe/shared/errors";
import { getSidianBillingReadiness } from "@/lib/stripe/billing/env";

/**
 * Client Stripe dédié à l'abonnement Sidian.
 *
 * Instance SÉPARÉE de `@/lib/stripe/client` : elle porte sa propre clé, et
 * aucun appel de ce module ne doit jamais passer `stripeAccount` — tout se
 * joue sur le compte plateforme. Un client partagé rendrait cette garantie
 * invérifiable par lecture.
 */

let cached: { key: string; client: Stripe } | null = null;

export function getSidianBillingStripeClient(): Stripe {
  const readiness = getSidianBillingReadiness();
  if (!readiness.enabled) {
    throw new StripeDomainError(
      "sidian_billing_not_configured",
      undefined,
      "terminal",
    );
  }

  if (cached && cached.key === readiness.secretKey) {
    return cached.client;
  }

  const client = new Stripe(readiness.secretKey, {
    apiVersion: SIDIAN_STRIPE_API_VERSION,
    typescript: true,
    timeout: 15_000,
    maxNetworkRetries: 2,
    appInfo: {
      name: "Sidian Billing",
      version: "0.1.0",
    },
  });

  cached = { key: readiness.secretKey, client };
  return client;
}

/** Réservé aux tests : évite qu'une clé mémorisée fuite d'un cas à l'autre. */
export function resetSidianBillingStripeClientCache(): void {
  cached = null;
}
