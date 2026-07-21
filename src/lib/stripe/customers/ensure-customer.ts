import "server-only";

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getStripeClient } from "@/lib/stripe/client";
import { bindStripeCustomerForConnectedAccount } from "@/lib/stripe/customers/bindings";
import { StripeDomainError, toSafeStripeError } from "@/lib/stripe/shared/errors";
import type { Database } from "@/types/database.generated";

type Db = Database;
type SidianEnvironment = "local" | "staging" | "production";

export type EnsureStripeCustomerResult = {
  customerId: string;
  created: boolean;
};

function customerMatchesScope(
  customer: Stripe.Customer | Stripe.DeletedCustomer,
  params: {
    prestataireId: string;
    clientPayeurId: string;
    sidianEnvironment: SidianEnvironment;
  },
): customer is Stripe.Customer {
  return (
    !("deleted" in customer && customer.deleted) &&
    customer.metadata?.sidian_prestataire_id === params.prestataireId &&
    customer.metadata?.sidian_client_payeur_id === params.clientPayeurId &&
    customer.metadata?.sidian_environment === params.sidianEnvironment
  );
}

/**
 * Obtient ou crée le Customer Stripe du couple (prestataire, client) DANS le
 * compte connecté. Réutilise le binding actif après revérification live des
 * métadonnées ; sinon crée un Customer scopé et le lie via le rôle writer.
 *
 * Sérialisation : appelé après claim_checkout_provisioning (une seule tentative
 * non terminale par créance), donc jamais deux créations concurrentes pour un
 * même couple via ce chemin.
 */
export async function ensureStripeCustomerForClient(params: {
  supabaseAdmin: SupabaseClient<Db>;
  prestataireId: string;
  clientPayeurId: string;
  stripeAccountId: string;
  clientEmail: string | null;
  clientNom: string | null;
  sidianEnvironment: SidianEnvironment;
  stripe?: Stripe;
}): Promise<EnsureStripeCustomerResult> {
  const stripe = params.stripe ?? getStripeClient();

  const { data: binding, error: bindingError } = await params.supabaseAdmin
    .from("stripe_customer_binding")
    .select("stripe_customer_id, stripe_account_id")
    .eq("prestataire_id", params.prestataireId)
    .eq("client_payeur_id", params.clientPayeurId)
    .eq("status", "active")
    .maybeSingle();
  if (bindingError) {
    throw new StripeDomainError(
      "stripe_customer_binding_lookup_failed",
      undefined,
      "retryable",
    );
  }

  if (
    binding?.stripe_customer_id &&
    binding.stripe_account_id === params.stripeAccountId
  ) {
    try {
      const existing = await stripe.customers.retrieve(
        binding.stripe_customer_id,
        {},
        { stripeAccount: params.stripeAccountId },
      );
      if (customerMatchesScope(existing, params)) {
        return { customerId: existing.id, created: false };
      }
    } catch {
      // Customer disparu / illisible : recréation contrôlée ci-dessous.
    }
  }

  let created: Stripe.Customer;
  try {
    created = await stripe.customers.create(
      {
        email: params.clientEmail ?? undefined,
        name: params.clientNom ?? undefined,
        metadata: {
          sidian_prestataire_id: params.prestataireId,
          sidian_client_payeur_id: params.clientPayeurId,
          sidian_environment: params.sidianEnvironment,
        },
      },
      { stripeAccount: params.stripeAccountId },
    );
  } catch (error) {
    throw toSafeStripeError(error);
  }

  // Invariant (03 §1 binding) : le Customer doit porter exactement les métadonnées.
  if (!customerMatchesScope(created, params)) {
    throw new StripeDomainError(
      "stripe_customer_metadata_invalid",
      undefined,
      "terminal",
    );
  }

  await bindStripeCustomerForConnectedAccount({
    prestataireId: params.prestataireId,
    clientPayeurId: params.clientPayeurId,
    stripeAccountId: params.stripeAccountId,
    stripeCustomerId: created.id,
    sidianEnvironment: params.sidianEnvironment,
  });

  return { customerId: created.id, created: true };
}
