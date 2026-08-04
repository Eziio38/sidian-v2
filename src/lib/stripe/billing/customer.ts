import "server-only";

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import { StripeDomainError, toSafeStripeError } from "@/lib/stripe/shared/errors";
import { getSidianBillingStripeClient } from "@/lib/stripe/billing/client";
import { getSidianBillingReadiness } from "@/lib/stripe/billing/env";
import type { Database } from "@/types/database.generated";

type AdminClient = SupabaseClient<Database>;

export type SidianBillingBinding = {
  prestataireId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  stripeStatus: string | null;
};

function customerMatchesScope(
  customer: Stripe.Customer | Stripe.DeletedCustomer,
  params: { prestataireId: string; environment: string },
): customer is Stripe.Customer {
  return (
    !("deleted" in customer && customer.deleted) &&
    customer.metadata?.sidian_prestataire_id === params.prestataireId &&
    customer.metadata?.sidian_environment === params.environment &&
    customer.metadata?.sidian_billing_scope === "subscription"
  );
}

export async function readSidianBillingBinding(
  supabaseAdmin: AdminClient,
  prestataireId: string,
): Promise<SidianBillingBinding | null> {
  const { data, error } = await supabaseAdmin
    .from("sidian_subscription")
    .select("prestataire_id, stripe_customer_id, stripe_subscription_id, stripe_status")
    .eq("prestataire_id", prestataireId)
    .maybeSingle();

  if (error) {
    throw new StripeDomainError(
      "sidian_billing_binding_lookup_failed",
      undefined,
      "retryable",
    );
  }
  if (!data) return null;

  return {
    prestataireId: data.prestataire_id,
    stripeCustomerId: data.stripe_customer_id,
    stripeSubscriptionId: data.stripe_subscription_id,
    stripeStatus: data.stripe_status,
  };
}

/**
 * Obtient ou crée le Customer de facturation du prestataire SUR LE COMPTE
 * PLATEFORME. Jamais d'option `stripeAccount` ici : ce Customer n'a rien à voir
 * avec les Customers Connect de `stripe_customer_binding`.
 *
 * `prestataireId` est toujours dérivé de la session côté appelant — la fonction
 * ne lit aucun identifiant fourni par le navigateur.
 */
export async function ensureSidianBillingCustomer(params: {
  supabaseAdmin: AdminClient;
  prestataireId: string;
  email: string | null;
  nom: string | null;
  stripe?: Stripe;
}): Promise<{ customerId: string; created: boolean }> {
  const readiness = getSidianBillingReadiness();
  if (!readiness.enabled) {
    throw new StripeDomainError(
      "sidian_billing_not_configured",
      undefined,
      "terminal",
    );
  }
  const stripe = params.stripe ?? getSidianBillingStripeClient();

  const binding = await readSidianBillingBinding(
    params.supabaseAdmin,
    params.prestataireId,
  );

  if (binding) {
    try {
      const existing = await stripe.customers.retrieve(binding.stripeCustomerId);
      if (
        customerMatchesScope(existing, {
          prestataireId: params.prestataireId,
          environment: readiness.environment,
        })
      ) {
        return { customerId: existing.id, created: false };
      }
    } catch {
      // Customer illisible : on ne réutilise pas une référence non vérifiable.
    }
    // Le binding existe mais ne correspond plus : on refuse de le remplacer en
    // silence — cela masquerait une erreur de configuration ou d'environnement.
    throw new StripeDomainError(
      "sidian_billing_customer_unverifiable",
      undefined,
      "terminal",
    );
  }

  let created: Stripe.Customer;
  try {
    created = await stripe.customers.create(
      {
        email: params.email ?? undefined,
        name: params.nom ?? undefined,
        metadata: {
          sidian_prestataire_id: params.prestataireId,
          sidian_environment: readiness.environment,
          sidian_billing_scope: "subscription",
        },
      },
      // Un double clic ne doit pas créer deux Customers facturables.
      { idempotencyKey: `sidian-billing-customer-${params.prestataireId}` },
    );
  } catch (error) {
    throw toSafeStripeError(error);
  }

  if (
    !customerMatchesScope(created, {
      prestataireId: params.prestataireId,
      environment: readiness.environment,
    })
  ) {
    throw new StripeDomainError(
      "sidian_billing_customer_metadata_invalid",
      undefined,
      "terminal",
    );
  }

  const { error } = await params.supabaseAdmin.rpc(
    "bind_sidian_subscription_customer",
    {
      p_prestataire_id: params.prestataireId,
      p_stripe_customer_id: created.id,
    },
  );
  if (error) {
    throw new StripeDomainError(
      "sidian_billing_customer_bind_failed",
      undefined,
      "retryable",
    );
  }

  return { customerId: created.id, created: true };
}
