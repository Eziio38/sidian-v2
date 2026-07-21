import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.generated";

type Db = Database;

export type PrestataireStripeReadiness = {
  configured: boolean;
  chargesEnabled: boolean;
  onboardingStatus: Database["public"]["Enums"]["stripe_onboarding_status"] | null;
};

/**
 * Projection Stripe locale, pour AFFICHAGE uniquement (cf. 03 §1 — jamais une
 * source de vérité pour une décision financière). La revérification live a
 * déjà lieu au moment de la création de Session (createPaymentCheckoutSession).
 */
export async function getPrestataireStripeReadiness(
  supabase: SupabaseClient<Db>,
  prestataireId: string,
): Promise<PrestataireStripeReadiness> {
  const { data, error } = await supabase
    .from("prestataire")
    .select("stripe_account_id, stripe_charges_enabled, stripe_onboarding_status")
    .eq("id", prestataireId)
    .maybeSingle();

  if (error) {
    throw new Error("prestataire_stripe_readiness_lookup_failed");
  }

  return {
    configured: Boolean(data?.stripe_account_id),
    chargesEnabled: Boolean(data?.stripe_charges_enabled),
    onboardingStatus: data?.stripe_onboarding_status ?? null,
  };
}
