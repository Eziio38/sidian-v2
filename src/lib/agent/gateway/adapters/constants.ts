/**
 * Constantes adapters auth G1-K.
 *
 * Headers / params de sélection tenant = hints **non fiables** :
 * toujours vérifiés contre les memberships serveur.
 */

/** Header de sélection tenant (hint non fiable). */
export const SIDIAN_TENANT_ID_HEADER = "x-sidian-tenant-id";

/** Alias accepté pour le hint tenant (même sémantique non fiable). */
export const SIDIAN_TENANT_ID_HEADER_ALIASES = [
  "x-tenant-id",
  "x-sidian-tenant",
] as const;

export const REQUEST_ID_HEADER = "x-request-id";
export const CORRELATION_ID_HEADER = "x-correlation-id";

/** Audience JWT utilisateur Supabase Auth. */
export const SUPABASE_AUTH_AUDIENCE = "authenticated";

/**
 * Rôle JWT technique — **jamais** accepté comme identité utilisateur final.
 * Un Bearer service_role doit être refusé (pas de représentation utilisateur RLS).
 */
export const SUPABASE_SERVICE_ROLE_CLAIM = "service_role";

/** Rôle JWT anon — pas une session utilisateur. */
export const SUPABASE_ANON_ROLE_CLAIM = "anon";

/**
 * Prefixe cookie session Supabase SSR.
 * Utilisé uniquement pour détecter la présence d’une session (pas pour lire le body).
 */
export const SUPABASE_AUTH_COOKIE_PREFIX = "sb-";
export const SUPABASE_AUTH_COOKIE_SUFFIX = "-auth-token";

/** Statuts d’abonnement considérés actifs pour la membership prestataire. */
export const ACTIVE_SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
] as const;

/** Statut d’abonnement → membership inactive. */
export const INACTIVE_SUBSCRIPTION_STATUS = "cancelled" as const;
