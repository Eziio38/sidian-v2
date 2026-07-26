/**
 * Adapters auth G1-K — Supabase Auth + membership `prestataire`.
 *
 * ## Flux JWT → principal → tenant
 *
 * ```
 * HTTP headers/cookies (ServerRequestAuthAdapter)
 *   → AuthMaterial (Bearer ou session cookie ; jamais body)
 *   → SupabaseAuthPrincipalResolver
 *        auth.getUser(jwt?)  // API officielle
 *        + contrôles iss/aud/exp/role
 *   → AuthenticatedPrincipal
 *   → SupabaseTenantMembershipResolver
 *        SELECT prestataire WHERE user_id = principal (RLS user)
 *        + vérif hint x-sidian-tenant-id
 *   → tenant_id + roles sanitizés
 *   → RequestGateway → TrustedExecutionContext
 * ```
 *
 * ## service_role — documentation d’usage
 *
 * **Aucun appel service_role dans ce dossier.**
 *
 * Les resolvers exigent un client utilisateur injecté :
 * - cookie SSR (`@/lib/supabase/server`), ou
 * - anon key + `Authorization: Bearer <JWT utilisateur>`
 *   (`createBearerScopedSupabaseClient`).
 *
 * Interdit :
 * - `createAdminClient` / `SUPABASE_SERVICE_ROLE_KEY` pour représenter
 *   l’utilisateur final ;
 * - contourner RLS membership via service_role ;
 * - accepter un JWT dont `role === "service_role"` comme session user.
 *
 * Si un worker technique doit agir hors session user, ce n’est **pas**
 * le chemin Request Gateway user — hors périmètre de ces adapters.
 */

export {
  SIDIAN_TENANT_ID_HEADER,
  SIDIAN_TENANT_ID_HEADER_ALIASES,
  REQUEST_ID_HEADER,
  CORRELATION_ID_HEADER,
  SUPABASE_AUTH_AUDIENCE,
  SUPABASE_SERVICE_ROLE_CLAIM,
  ACTIVE_SUBSCRIPTION_STATUSES,
  INACTIVE_SUBSCRIPTION_STATUS,
} from "./constants";

export {
  decodeJwtPayload,
  buildExpectedSupabaseIssuer,
  validateUserJwtClaims,
} from "./jwt-claims";
export type { JwtPayloadClaims, JwtClaimsValidation } from "./jwt-claims";

export {
  createBearerScopedSupabaseClient,
} from "./user-scoped-client";
export type {
  GatewayUserSupabaseClient,
  CreateBearerScopedSupabaseClientParams,
} from "./user-scoped-client";

export {
  SupabaseAuthPrincipalResolver,
  createSupabaseAuthPrincipalResolver,
} from "./supabase-auth-principal-resolver";
export type { SupabaseAuthPrincipalResolverDeps } from "./supabase-auth-principal-resolver";

export {
  SupabaseTenantMembershipResolver,
  createSupabaseTenantMembershipResolver,
} from "./tenant-membership-resolver";
export type { SupabaseTenantMembershipResolverDeps } from "./tenant-membership-resolver";

export {
  ServerRequestAuthAdapter,
  createServerRequestAuthAdapter,
  extractServerRequestAuth,
} from "./server-request-auth-adapter";
export type {
  ServerRequestAuthHeaders,
  ServerRequestAuthAdapterInput,
  ServerRequestAuthAdapterResult,
} from "./server-request-auth-adapter";
