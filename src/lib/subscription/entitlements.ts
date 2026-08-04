/**
 * Résolution des droits d'un prestataire à partir de son abonnement.
 *
 * Module PUR (pas de `server-only`, pas d'I/O) pour rester testable ; il est
 * consommé exclusivement côté serveur via `./server`.
 *
 * ## Ce qui est décidé ici, et ce qui ne l'est pas
 *
 * La seule règle de restriction ÉTABLIE dans le dépôt est celle du gateway
 * agent (`src/lib/agent/gateway/adapters/constants.ts`) : `trialing`, `active`
 * et `past_due` valent membership active ; `cancelled` vaut membership
 * inactive. Ce résolveur reprend exactement cette règle.
 *
 * Aucune dégradation plus fine n'est inventée : ni quota de clients, ni limite
 * de créances, ni gel des relances en `past_due`. `docs/SIDIAN_02_PRD_V2.md` §6
 * décrit une offre unique à 49 € HT sans limites d'usage, et la grille
 * Solo/Studio/Agence y est explicitement marquée « HYPOTHÈSE — non engagée ».
 * Encoder ces limites serait inventer du produit.
 *
 * `trialing` reste donc permissif : c'est l'état par défaut de tous les comptes
 * existants, et les restreindre ici les mettrait dehors sans décision produit.
 */

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "cancelled";

export type SubscriptionCapability =
  /** Utiliser le produit (clients, créances, relances, encaissements). */
  | "product_access"
  /** Démarrer un abonnement payant via Checkout. */
  | "billing_start_subscription"
  /** Ouvrir le portail de facturation Stripe (moyen de paiement, résiliation). */
  | "billing_manage_subscription";

/** État affichable, sans copie produit : l'UI compose son propre texte. */
export type SubscriptionState =
  | "billing_unavailable"
  | "no_subscription"
  | "trialing"
  | "active"
  | "past_due"
  | "cancelled";

export type SubscriptionBindingSnapshot = {
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  /** Statut brut Stripe, tel que stocké par le webhook. */
  stripeStatus: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export type SubscriptionEntitlements = {
  status: SubscriptionStatus;
  state: SubscriptionState;
  /** false ⇒ aucune gestion d'abonnement possible, et il faut le dire. */
  billingConfigured: boolean;
  hasBillingCustomer: boolean;
  hasOpenStripeSubscription: boolean;
  binding: SubscriptionBindingSnapshot | null;
  capabilities: Record<SubscriptionCapability, boolean>;
};

/** Statut d'abonnement ne donnant plus accès au produit (règle existante). */
const INACTIVE_STATUS: SubscriptionStatus = "cancelled";

/**
 * Statuts Stripe pour lesquels un abonnement existe encore côté Stripe —
 * en démarrer un second créerait un double prélèvement.
 */
const CLOSED_STRIPE_STATUSES = new Set([
  "canceled",
  "cancelled",
  "incomplete_expired",
]);

export function isStripeSubscriptionOpen(
  stripeStatus: string | null | undefined,
): boolean {
  const normalized = (stripeStatus ?? "").trim().toLowerCase();
  if (normalized === "") return false;
  return !CLOSED_STRIPE_STATUSES.has(normalized);
}

function resolveState(input: {
  status: SubscriptionStatus;
  billingConfigured: boolean;
  hasOpenStripeSubscription: boolean;
}): SubscriptionState {
  if (!input.billingConfigured) return "billing_unavailable";
  if (!input.hasOpenStripeSubscription && input.status !== "cancelled") {
    // Compte encore en essai / actif hérité, mais aucun abonnement Stripe :
    // l'état honnête est « pas d'abonnement », pas « actif ».
    return "no_subscription";
  }
  return input.status;
}

export function resolveSubscriptionEntitlements(input: {
  status: SubscriptionStatus;
  billingConfigured: boolean;
  binding: SubscriptionBindingSnapshot | null;
}): SubscriptionEntitlements {
  const hasBillingCustomer = Boolean(input.binding?.stripeCustomerId);
  const hasOpenStripeSubscription =
    Boolean(input.binding?.stripeSubscriptionId) &&
    isStripeSubscriptionOpen(input.binding?.stripeStatus);

  const productAccess = input.status !== INACTIVE_STATUS;

  return {
    status: input.status,
    state: resolveState({
      status: input.status,
      billingConfigured: input.billingConfigured,
      hasOpenStripeSubscription,
    }),
    billingConfigured: input.billingConfigured,
    hasBillingCustomer,
    hasOpenStripeSubscription,
    binding: input.binding,
    capabilities: {
      product_access: productAccess,
      // Sans configuration Stripe facturation, rien n'est proposé : pas de
      // bouton qui échouerait, pas d'abonnement simulé.
      billing_start_subscription:
        input.billingConfigured && !hasOpenStripeSubscription,
      billing_manage_subscription:
        input.billingConfigured && hasBillingCustomer,
    },
  };
}

export function hasSubscriptionCapability(
  entitlements: SubscriptionEntitlements,
  capability: SubscriptionCapability,
): boolean {
  return entitlements.capabilities[capability];
}
