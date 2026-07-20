import "server-only";

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { getSidianEnvironment } from "@/config/env-server";
import { getAppUrl } from "@/lib/auth/urls";
import { getStripeClient } from "@/lib/stripe/client";
import { StripeDomainError, toSafeStripeError } from "@/lib/stripe/shared/errors";
import type { Database } from "@/types/database.generated";

const accountLinkKindSchema = z.enum(["onboarding", "update"]);

export type AccountLinkKind = z.infer<typeof accountLinkKindSchema>;

/**
 * Allowlist interne — aucune URL arbitraire fournie par le navigateur.
 * Les chemins sont relatifs à NEXT_PUBLIC_APP_URL.
 */
export const STRIPE_ACCOUNT_LINK_PATHS = {
  refresh: "/app/stripe/reprise",
  return: "/app/stripe/retour",
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
  const kind = accountLinkKindSchema.parse(params.kind ?? "onboarding");
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
    const account = await stripe.accounts.retrieve(prestataire.stripe_account_id);
    const sidianEnvironment =
      params.sidianEnvironment ?? getSidianEnvironment();
    if (
      account.id !== prestataire.stripe_account_id ||
      account.metadata?.sidian_prestataire_id !== prestataire.id ||
      account.metadata?.sidian_environment !== sidianEnvironment ||
      (prestataire.stripe_connect_operation_key &&
        account.metadata?.sidian_provisioning_operation_id !==
          prestataire.stripe_connect_operation_key) ||
      account.type !== "express" ||
      account.country !== "FR" ||
      account.controller?.type !== "application" ||
      account.controller.requirement_collection !== "stripe" ||
      account.controller.stripe_dashboard?.type !== "express"
    ) {
      throw new StripeDomainError("stripe_account_scope_mismatch");
    }
    return await stripe.accountLinks.create({
      account: account.id,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: kind === "update" ? "account_update" : "account_onboarding",
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
