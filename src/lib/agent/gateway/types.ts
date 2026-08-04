/**
 * Types du Request Gateway / trust boundary (G1-K).
 *
 * Séparation stricte :
 * - ExternalToolRequest — données métier non fiables (appelant)
 * - AuthenticatedPrincipal — identité vérifiée (resolvers / adapters)
 * - TrustedExecutionContext — contexte serveur transmis au Router
 *
 * Aucune I/O concrète ici — les adapters (tâche C) implémentent les resolvers.
 */

import type {
  ActorType,
  AgentMode,
  AutonomyLevel,
  ResourceKind,
} from "@/lib/agent/permissions/types";

import type {
  GatewayDecision,
  GatewayDenialDecision,
  GatewayErrorDescriptor,
} from "./errors";

export type {
  ActorType,
  AgentMode,
  AutonomyLevel,
  GatewayDecision,
  GatewayDenialDecision,
  GatewayErrorDescriptor,
  ResourceKind,
};

/**
 * Méthodes d’auth déjà présentes dans le dépôt (Supabase Auth).
 * Pas d’OAuth / MFA / SSO inventés.
 */
export const AUTHENTICATION_METHODS = [
  "supabase_auth_session",
  "supabase_auth_jwt",
] as const;

export type AuthenticationMethod = (typeof AUTHENTICATION_METHODS)[number];

/**
 * Niveau de confiance du contexte d’exécution.
 * Seul `authenticated_tenant_member` est produit par un resolve réussi.
 */
export const TRUST_LEVELS = ["authenticated_tenant_member"] as const;

export type TrustLevel = (typeof TRUST_LEVELS)[number];

/**
 * Rôles sanitizés autorisés dans le contexte de confiance (EPICU V1).
 * Les resolvers ne doivent pas injecter de rôles hors allowlist.
 */
export const TRUSTED_ROLE_ALLOWLIST = ["owner", "member"] as const;

export type TrustedRole = (typeof TRUSTED_ROLE_ALLOWLIST)[number];

/**
 * Champs de confiance / poison refusés dans ExternalToolRequest (body).
 * Le schéma Zod `.strict()` les rejette ; cette liste documente le contrat.
 */
export const EXTERNAL_REQUEST_FORBIDDEN_FIELDS = [
  "tenant_id",
  "actor_id",
  "actor_type",
  "roles",
  "permissions",
  "grants",
  "tool_definition",
  "executor",
  "human_validation",
  "approval_status",
  "service_role",
  "authenticated_claims",
  "membership",
  "trusted",
  "jwt",
  "access_token",
  "refresh_token",
  "authorization",
  "cookie",
  "session",
  "claims",
] as const;

export type ExternalRequestForbiddenField =
  (typeof EXTERNAL_REQUEST_FORBIDDEN_FIELDS)[number];

/**
 * Ressource métier externe — sans `tenant_id` (ancré côté serveur).
 */
export type ExternalToolResource = {
  kind: ResourceKind;
  resource_id: string;
};

/**
 * Intention outil fournie par l’appelant — données métier uniquement.
 * Aucun champ d’identité / autorité / preuve déclarative.
 */
export type ExternalToolRequest = {
  tool_id: string;
  tool_version: string;
  mode: AgentMode;
  requested_autonomy_level: AutonomyLevel;
  arguments: unknown;
  resource?: ExternalToolResource;
  idempotency_key?: string;
  approval_id?: string;
  correlation_id?: string;
};

/**
 * Matériel d’authentification fourni **uniquement** par l’adapter serveur.
 * Jamais depuis le body ExternalToolRequest.
 *
 * - `bearer_token` / credential opaque : consommés par le resolver uniquement ;
 *   jamais recopiés dans TrustedExecutionContext ni audit.
 * - Préférer `session_id_hash` déjà haché côté adapter (pas de cookie brut).
 */
export type AuthMaterial = {
  /** false → décision `unauthenticated` sans appeler le resolver. */
  credential_present: boolean;
  /** Bearer opaque pour résolution JWT/session — jamais dans le contexte. */
  bearer_token?: string;
  /** Hash opaque de session (optionnel) — jamais le cookie brut. */
  session_id_hash?: string;
};

/**
 * Métadonnées requête sanitizées (adapter / edge).
 * `requested_tenant_id` est un **hint non fiable** (header/param) —
 * doit être vérifié contre les memberships serveur.
 */
export type GatewayRequestMetadata = {
  request_id: string;
  correlation_id?: string;
  requested_tenant_id?: string;
};

/**
 * Entrée gateway — horloge `now` injectée (jamais Date.now() implicite).
 */
export type GatewayRequest = {
  externalRequest: ExternalToolRequest;
  authMaterial: AuthMaterial;
  requestMetadata: GatewayRequestMetadata;
  /** Instant ISO-8601 UTC injecté. */
  now: string;
};

/**
 * Identité authentifiée — construite par AuthPrincipalResolver.
 * Jamais de JWT brut, refresh token, access token, claims inutiles.
 */
export type AuthenticatedPrincipal = {
  /** Subject auth (ex. auth.users.id / JWT `sub`). */
  principal_subject: string;
  actor_id: string;
  actor_type: ActorType;
  authentication_method: AuthenticationMethod;
  authenticated_at?: string;
  /** Hash opaque de session — jamais l’identifiant de session brut. */
  session_id_hash?: string;
  /** Expiration jeton (ISO) si connue — comparée à `now` injecté. */
  expires_at?: string;
  /** Email confirmé (Supabase) — utile au fail-closed membership. */
  email_confirmed?: boolean;
  /** Acteur désactivé côté auth (ban / disabled) si le modèle le fournit. */
  actor_disabled?: boolean;
};

export type TrustedExecutionContext = {
  tenant_id: string;
  actor_id: string;
  actor_type: ActorType;
  /** Rôles sanitizés (allowlist) — jamais rôles déclaratifs client. */
  roles: TrustedRole[];
  authenticated_at?: string;
  authentication_method: AuthenticationMethod;
  session_id_hash?: string;
  principal_subject: string;
  trust_level: TrustLevel;
  request_id: string;
  correlation_id: string;
  /** Horloge injectée propagée — déterminisme. */
  now: string;
};

export type GatewayResolutionAuthenticated = {
  status: "authenticated";
  decision: "authenticated";
  context: TrustedExecutionContext;
  external_request: ExternalToolRequest;
};

export type GatewayResolutionDenied = {
  status: "denied";
  decision: GatewayDenialDecision;
  error: GatewayErrorDescriptor;
  request_id?: string;
  correlation_id?: string;
};

/**
 * Échec de schéma / construction hors décisions d’auth membership.
 */
export type GatewayResolutionInvalid = {
  status: "invalid";
  decision: null;
  error: GatewayErrorDescriptor;
  request_id?: string;
  correlation_id?: string;
};

export type GatewayResolution =
  | GatewayResolutionAuthenticated
  | GatewayResolutionDenied
  | GatewayResolutionInvalid;

/** Alias public — résultat de `RequestGateway.resolve`. */
export type GatewayResult = GatewayResolution;

export type RequestGateway = {
  resolve(request: GatewayRequest): Promise<GatewayResolution>;
};

/* -------------------------------------------------------------------------- */
/* Resolvers — interfaces pour adapters (tâche C)                             */
/* -------------------------------------------------------------------------- */

export type ResolvePrincipalInput = {
  authMaterial: AuthMaterial;
  /** Horloge injectée — comparaison d’expiration, pas Date.now(). */
  now: string;
};

export type ResolvePrincipalResult =
  | { outcome: "authenticated"; principal: AuthenticatedPrincipal }
  | { outcome: "unauthenticated" }
  | { outcome: "invalid_token" }
  | { outcome: "expired_token" }
  | { outcome: "issuer_mismatch" }
  | { outcome: "audience_mismatch" }
  | { outcome: "actor_disabled" }
  | { outcome: "unavailable" };

/**
 * Résolution d’identité authentifiée.
 * Implémentations concrètes : `adapters/` (Supabase Auth session / JWT).
 * Vérifie expiration, issuer et audience lorsque disponibles côté app.
 */
export type AuthPrincipalResolver = {
  resolvePrincipal(
    input: ResolvePrincipalInput,
  ): Promise<ResolvePrincipalResult>;
};

export type ResolveMembershipInput = {
  principal: AuthenticatedPrincipal;
  /**
   * Hint non fiable (header / param) — obligatoire de vérifier
   * contre les memberships serveur. Absent → sélection déterministe
   * (ex. unique membership EPICU V1) ou `tenant_ambiguous`.
   */
  requested_tenant_id?: string;
  now: string;
};

export type ResolveMembershipResult =
  | {
      outcome: "resolved";
      tenant_id: string;
      roles: readonly string[];
      membership_status: "active";
    }
  | { outcome: "tenant_membership_missing" }
  | { outcome: "tenant_membership_inactive" }
  | { outcome: "tenant_ambiguous" }
  | { outcome: "tenant_not_found" }
  | { outcome: "actor_disabled" }
  | { outcome: "unavailable" };

/**
 * Résolution d’appartenance tenant.
 * EPICU V1 : tenant = `prestataire.id` lié à `auth.uid()` (relecture DB).
 * Implémentations : `adapters/` (TenantMembershipResolver).
 */
export type TenantMembershipResolver = {
  resolveMembership(
    input: ResolveMembershipInput,
  ): Promise<ResolveMembershipResult>;
};

export type RequestGatewayDependencies = {
  principalResolver: AuthPrincipalResolver;
  membershipResolver: TenantMembershipResolver;
};
