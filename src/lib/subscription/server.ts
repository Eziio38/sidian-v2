import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { isSidianBillingEnabled } from "@/lib/stripe/billing/env";
import type { Database } from "@/types/database.generated";

import {
  resolveSubscriptionEntitlements,
  type SubscriptionBindingSnapshot,
  type SubscriptionCapability,
  type SubscriptionEntitlements,
  type SubscriptionStatus,
} from "./entitlements";

/**
 * Lecture serveur des droits d'abonnement.
 *
 * Le tenant est TOUJOURS dérivé de la session (auth.uid()) et la lecture passe
 * par le client utilisateur sous RLS — jamais service_role, jamais un id fourni
 * par l'appelant.
 */

type UserClient = SupabaseClient<Database>;

export class SubscriptionCapabilityError extends Error {
  readonly capability: SubscriptionCapability;
  readonly entitlements: SubscriptionEntitlements | null;

  constructor(
    capability: SubscriptionCapability,
    entitlements: SubscriptionEntitlements | null,
  ) {
    super(`subscription_capability_denied:${capability}`);
    this.name = "SubscriptionCapabilityError";
    this.capability = capability;
    this.entitlements = entitlements;
  }
}

export type CurrentSubscription = {
  prestataireId: string;
  email: string | null;
  nom: string | null;
  entitlements: SubscriptionEntitlements;
};

export async function loadSubscriptionForPrestataire(
  supabase: UserClient,
  userId: string,
  billingConfigured: boolean = isSidianBillingEnabled(),
): Promise<CurrentSubscription | null> {
  const { data: prestataire, error } = await supabase
    .from("prestataire")
    .select("id, nom, email, subscription_status")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("subscription_prestataire_lookup_failed");
  }
  if (!prestataire) return null;

  // RLS : sidian_subscription n'est lisible que par son propriétaire.
  const { data: binding, error: bindingError } = await supabase
    .from("sidian_subscription")
    .select(
      "stripe_customer_id, stripe_subscription_id, stripe_status, current_period_end, cancel_at_period_end",
    )
    .eq("prestataire_id", prestataire.id)
    .maybeSingle();

  if (bindingError) {
    throw new Error("subscription_binding_lookup_failed");
  }

  const snapshot: SubscriptionBindingSnapshot | null = binding
    ? {
        stripeCustomerId: binding.stripe_customer_id,
        stripeSubscriptionId: binding.stripe_subscription_id,
        stripeStatus: binding.stripe_status,
        currentPeriodEnd: binding.current_period_end,
        cancelAtPeriodEnd: binding.cancel_at_period_end,
      }
    : null;

  return {
    prestataireId: prestataire.id,
    email: prestataire.email,
    nom: prestataire.nom,
    entitlements: resolveSubscriptionEntitlements({
      status: prestataire.subscription_status as SubscriptionStatus,
      billingConfigured,
      binding: snapshot,
    }),
  };
}

/** null si aucune session ou aucun prestataire — l'appelant décide de la suite. */
export async function getCurrentSubscription(): Promise<CurrentSubscription | null> {
  const user = await getAuthenticatedUser();
  if (!user) return null;

  const supabase = await createClient();
  return loadSubscriptionForPrestataire(supabase, user.id);
}

/**
 * Garde serveur. Lève `SubscriptionCapabilityError` si le droit est refusé :
 * une vérification côté client ne doit jamais être le seul rempart.
 */
export async function requireSubscriptionCapability(
  capability: SubscriptionCapability,
): Promise<CurrentSubscription> {
  const current = await getCurrentSubscription();
  if (!current) {
    throw new SubscriptionCapabilityError(capability, null);
  }
  if (!current.entitlements.capabilities[capability]) {
    throw new SubscriptionCapabilityError(capability, current.entitlements);
  }
  return current;
}
