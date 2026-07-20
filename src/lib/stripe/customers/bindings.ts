import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import {
  getSidianEnvironment,
  getStripeBindingWriterEnv,
} from "@/config/env-server";
import { getStripeClient } from "@/lib/stripe/client";
import { StripeDomainError } from "@/lib/stripe/shared/errors";
import type { Database } from "@/types/database.generated";

type Db = Database;
type BindingRow = Db["public"]["Tables"]["stripe_customer_binding"]["Row"];
type PaymentLinkRow = Db["public"]["Tables"]["payment_link"]["Row"];

function createStripeCustomerBindingWriterClient(): SupabaseClient<Db> {
  const env = getStripeBindingWriterEnv();
  return createClient<Db>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      accessToken: async () => env.SUPABASE_STRIPE_BINDING_WRITER_JWT,
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

/**
 * Remplace le binding actif : ancien → superseded, nouveau → active.
 * Ne jamais écraser silencieusement stripe_customer_id.
 */
export async function replaceStripeCustomerBinding(params: {
  supabaseUser: SupabaseClient<Db>;
  clientPayeurId: string;
  stripeCustomerId: string;
  stripe?: Stripe;
  sidianEnvironment?: "local" | "staging" | "production";
}): Promise<BindingRow> {
  const { data: authData, error: authError } = await params.supabaseUser.auth.getUser();
  if (authError || !authData.user) throw new StripeDomainError("not_authenticated");

  const { data: prestataire, error: prestataireError } = await params.supabaseUser
    .from("prestataire")
    .select("id, stripe_account_id")
    .eq("user_id", authData.user.id)
    .single();
  if (prestataireError || !prestataire?.stripe_account_id) {
    throw new StripeDomainError("stripe_account_not_configured");
  }
  const { data: client, error: clientError } = await params.supabaseUser
    .from("client_payeur")
    .select("id")
    .eq("id", params.clientPayeurId)
    .single();
  if (clientError || !client) throw new StripeDomainError("client_payeur_not_found");

  const stripe = params.stripe ?? getStripeClient();
  let customer: Stripe.Customer | Stripe.DeletedCustomer;
  try {
    customer = await stripe.customers.retrieve(
      params.stripeCustomerId,
      {},
      { stripeAccount: prestataire.stripe_account_id },
    );
  } catch {
    throw new StripeDomainError("stripe_customer_not_found_in_connected_account");
  }
  const sidianEnvironment =
    params.sidianEnvironment ?? getSidianEnvironment();
  if (
    customer.deleted ||
    customer.id !== params.stripeCustomerId ||
    customer.metadata?.sidian_prestataire_id !== prestataire.id ||
    customer.metadata?.sidian_client_payeur_id !== params.clientPayeurId ||
    customer.metadata?.sidian_environment !== sidianEnvironment
  ) {
    throw new StripeDomainError("stripe_customer_not_found_in_connected_account");
  }

  const writer = createStripeCustomerBindingWriterClient();
  const { data, error } = await writer.rpc(
    "replace_verified_stripe_customer_binding",
    {
      p_prestataire_id: prestataire.id,
      p_client_payeur_id: params.clientPayeurId,
      p_stripe_account_id: prestataire.stripe_account_id,
      p_stripe_customer_id: params.stripeCustomerId,
      p_sidian_environment: sidianEnvironment,
    },
  );

  if (error || !data) {
    throw new StripeDomainError("stripe_customer_binding_replace_failed");
  }

  return data as BindingRow;
}

export async function revokeStripeCustomerBinding(params: {
  supabaseAdmin: SupabaseClient<Db>;
  prestataireId: string;
  clientPayeurId: string;
}): Promise<BindingRow> {
  const { data, error } = await params.supabaseAdmin.rpc(
    "revoke_stripe_customer_binding",
    {
      p_prestataire_id: params.prestataireId,
      p_client_payeur_id: params.clientPayeurId,
    },
  );
  if (error || !data) {
    throw new StripeDomainError("stripe_customer_binding_revoke_failed");
  }
  return data as BindingRow;
}

export function hashPaymentLinkToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function generatePaymentLinkToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString("base64url");
  return { rawToken, tokenHash: hashPaymentLinkToken(rawToken) };
}

export async function createPaymentLinkForCreance(params: {
  supabaseAdmin: SupabaseClient<Db>;
  creanceId: string;
}): Promise<{ link: PaymentLinkRow; rawToken: string }> {
  const { rawToken, tokenHash } = generatePaymentLinkToken();
  const { data, error } = await params.supabaseAdmin.rpc(
    "create_payment_link_for_creance",
    {
      p_creance_id: params.creanceId,
      p_token_hash: tokenHash,
    },
  );

  if (error || !data) {
    throw new StripeDomainError("payment_link_create_failed");
  }

  return { link: data as PaymentLinkRow, rawToken };
}

export async function revokePaymentLink(params: {
  supabaseAdmin: SupabaseClient<Db>;
  paymentLinkId: string;
}): Promise<PaymentLinkRow> {
  const { data, error } = await params.supabaseAdmin.rpc("revoke_payment_link", {
    p_payment_link_id: params.paymentLinkId,
  });

  if (error || !data) {
    throw new StripeDomainError("payment_link_revoke_failed");
  }

  return data as PaymentLinkRow;
}
