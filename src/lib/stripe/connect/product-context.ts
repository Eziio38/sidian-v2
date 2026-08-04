import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { StripeDomainError } from "@/lib/stripe/shared/errors";
import type { Database } from "@/types/database.generated";

export type StripeConnectProductContext = {
  hasConnectedAccount: boolean;
  hasReceivable: boolean;
};

/**
 * Contexte dérivé exclusivement de la session/RLS. Il empêche la création
 * précoce d'un compte Connect avant le premier paiement à recevoir, tout en
 * autorisant la reprise d'un compte déjà provisionné.
 */
export async function getStripeConnectProductContext(
  supabaseUser: SupabaseClient<Database>,
): Promise<StripeConnectProductContext> {
  const { data: authData, error: authError } = await supabaseUser.auth.getUser();
  if (authError || !authData.user) {
    throw new StripeDomainError("not_authenticated", undefined, "terminal");
  }

  const [prestataireResult, receivableResult] = await Promise.all([
    supabaseUser
      .from("prestataire")
      .select("stripe_account_id")
      .eq("user_id", authData.user.id)
      .single(),
    supabaseUser
      .from("creance")
      .select("id")
      .is("archived_at", null)
      .limit(1)
      .maybeSingle(),
  ]);

  if (prestataireResult.error || !prestataireResult.data) {
    throw new StripeDomainError(
      "stripe_prestataire_lookup_failed",
      undefined,
      "retryable",
    );
  }
  if (receivableResult.error) {
    throw new StripeDomainError(
      "stripe_receivable_context_lookup_failed",
      undefined,
      "retryable",
    );
  }

  return {
    hasConnectedAccount: Boolean(prestataireResult.data.stripe_account_id),
    hasReceivable: Boolean(receivableResult.data),
  };
}
