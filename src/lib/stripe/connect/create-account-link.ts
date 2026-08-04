import "server-only";

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { getSidianEnvironment } from "@/config/env-server";
import { getAppUrl } from "@/lib/auth/urls";
import { getStripeClient } from "@/lib/stripe/client";
import { assertConnectedAccountIdentity } from "@/lib/stripe/connect/account-identity";
import { StripeDomainError, toSafeStripeError } from "@/lib/stripe/shared/errors";
import type { Database } from "@/types/database.generated";

const accountLinkKindSchema = z.literal("onboarding");

export type AccountLinkKind = z.infer<typeof accountLinkKindSchema>;

/**
 * Allowlist interne — aucune URL arbitraire fournie par le navigateur.
 * Les chemins sont relatifs à NEXT_PUBLIC_APP_URL.
 */
export const STRIPE_ACCOUNT_LINK_PATHS = {
  refresh: "/app/connexion-stripe/reprise",
  return: "/app/connexion-stripe/retour",
} as const;

export function buildAllowlistedAccountLinkUrls(appUrl = getAppUrl()): {
  refreshUrl: string;
  returnUrl: string;
} {
  const base = appUrl.replace(/\/$/, "");
  return {
    refreshUrl: `${base}${STRIPE_ACCOUNT_LINK_PATHS.refresh}`,
    returnUrl: `${base}${STRIPE_ACCOUNT_LINK_PATHS.return}`,
  };
}

/**
 * Génère un Account Link frais à usage unique.
 * collection_options.fields = currently_due (pas future_requirements=include au MVP).
 */
export async function createConnectedAccountLink(params: {
  supabaseUser: SupabaseClient<Database>;
  kind?: AccountLinkKind;
  stripe?: Stripe;
  sidianEnvironment?: "local" | "staging" | "production";
}): Promise<Stripe.AccountLink> {
  const kind = accountLinkKindSchema.safeParse(params.kind ?? "onboarding");
  if (!kind.success) {
    throw new StripeDomainError(
      "stripe_account_link_kind_not_supported",
      undefined,
      "terminal",
    );
  }

  const stripe = params.stripe ?? getStripeClient();
  const { data: authData, error: authError } = await params.supabaseUser.auth.getUser();
  if (authError || !authData.user) {
    throw new StripeDomainError("not_authenticated");
  }
  const { data: prestataire, error: prestataireError } = await params.supabaseUser
    .from("prestataire")
    .select("id, stripe_account_id, stripe_connect_operation_key")
    .eq("user_id", authData.user.id)
    .single();
  if (prestataireError || !prestataire?.stripe_account_id) {
    throw new StripeDomainError("stripe_account_not_configured");
  }
  const { refreshUrl, returnUrl } = buildAllowlistedAccountLinkUrls();

  try {
    const retrieved = await stripe.accounts.retrieve(prestataire.stripe_account_id);
    const sidianEnvironment =
      params.sidianEnvironment ?? getSidianEnvironment();
    const account = assertConnectedAccountIdentity({
      account: retrieved,
      expectedAccountId: prestataire.stripe_account_id,
      prestataireId: prestataire.id,
      operationKey: prestataire.stripe_connect_operation_key,
      sidianEnvironment,
    });
    return await stripe.accountLinks.create({
      account: account.id,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      // Express possède un Dashboard hébergé Stripe : account_update n'est pas
      // autorisé par Stripe pour ce type de compte.
      type: "account_onboarding",
      collection_options: {
        fields: "currently_due",
      },
    });
  } catch (error) {
    throw toSafeStripeError(error);
  }
}

export function assertAllowlistedAccountLinkUrl(url: string): void {
  const { refreshUrl, returnUrl } = buildAllowlistedAccountLinkUrls();
  if (url !== refreshUrl && url !== returnUrl) {
    throw new StripeDomainError("stripe_account_link_url_not_allowlisted");
  }
}
