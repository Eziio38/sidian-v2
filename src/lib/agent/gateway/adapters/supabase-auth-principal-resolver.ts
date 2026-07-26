/**
 * SupabaseAuthPrincipalResolver — résolution JWT/session via API officielle.
 *
 * Flux :
 * 1. Refuse credential absent ;
 * 2. `supabase.auth.getUser(jwt?)` (vérification Auth serveur — pas de fake local) ;
 * 3. Contrôles applicatifs iss / aud / exp / rôle (refuse service_role) ;
 * 4. Refuse acteur banni / soft-deleted ;
 * 5. Produit AuthenticatedPrincipal **sans** JWT brut.
 *
 * ## service_role
 * Aucun usage. Le client injecté doit être anon + session/JWT utilisateur.
 */

import { createHash } from "node:crypto";

import type { User } from "@supabase/supabase-js";

import type {
  AuthPrincipalResolver,
  AuthenticatedPrincipal,
  ResolvePrincipalInput,
  ResolvePrincipalResult,
} from "@/lib/agent/gateway/types";

import {
  buildExpectedSupabaseIssuer,
  decodeJwtPayload,
  validateUserJwtClaims,
} from "./jwt-claims";
import type { GatewayUserSupabaseClient } from "./user-scoped-client";

export type SupabaseAuthPrincipalResolverDeps = {
  /**
   * Client utilisateur injecté (cookie SSR ou Bearer + anon).
   * **Jamais** un client `service_role` / admin.
   */
  supabase: GatewayUserSupabaseClient;
  /**
   * URL publique Supabase — pour dériver l’issuer attendu `${url}/auth/v1`.
   * Requis pour le contrôle issuer lorsque des claims JWT sont présents.
   */
  supabaseUrl: string;
  /** Audience attendue — défaut `authenticated`. */
  expectedAudience?: string;
};

function hashOpaque(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isActorDisabled(user: User, now: string): boolean {
  if (typeof user.deleted_at === "string" && user.deleted_at.length > 0) {
    return true;
  }
  if (typeof user.banned_until === "string" && user.banned_until.length > 0) {
    const banMs = Date.parse(user.banned_until);
    const nowMs = Date.parse(now);
    if (Number.isFinite(banMs) && Number.isFinite(nowMs) && banMs > nowMs) {
      return true;
    }
    // Ban timestamp illisible → fail-closed.
    if (!Number.isFinite(banMs) || !Number.isFinite(nowMs)) {
      return true;
    }
  }
  return false;
}

function classifyAuthFailure(error: unknown): ResolvePrincipalResult {
  if (error === null || error === undefined) {
    return { outcome: "invalid_token" };
  }

  const record =
    typeof error === "object" ? (error as Record<string, unknown>) : null;
  const code =
    record && typeof record.code === "string" ? record.code.toLowerCase() : "";
  const message =
    record && typeof record.message === "string"
      ? record.message.toLowerCase()
      : "";
  const status =
    record && typeof record.status === "number" ? record.status : undefined;

  if (
    code.includes("banned") ||
    message.includes("banned") ||
    code === "user_banned"
  ) {
    return { outcome: "actor_disabled" };
  }

  if (
    code.includes("expired") ||
    message.includes("expired") ||
    code === "session_expired" ||
    message.includes("jwt expired")
  ) {
    return { outcome: "expired_token" };
  }

  if (
    status === 503 ||
    status === 502 ||
    status === 504 ||
    status === 429 ||
    code === "over_request_rate_limit" ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("econnrefused") ||
    message.includes("timeout")
  ) {
    return { outcome: "unavailable" };
  }

  // 401 / bad JWT / session absente → token invalide (pas unauthenticated :
  // credential_present était true).
  return { outcome: "invalid_token" };
}

function toPrincipal(params: {
  user: User;
  authentication_method: AuthenticatedPrincipal["authentication_method"];
  session_id_hash?: string;
  expires_at?: string;
  now: string;
}): AuthenticatedPrincipal {
  const { user, authentication_method, session_id_hash, expires_at, now } =
    params;

  const emailConfirmed = Boolean(user.email_confirmed_at ?? user.confirmed_at);
  const actorDisabled = isActorDisabled(user, now);

  return {
    principal_subject: user.id,
    actor_id: user.id,
    actor_type: "human",
    authentication_method,
    authenticated_at: user.last_sign_in_at ?? now,
    email_confirmed: emailConfirmed,
    actor_disabled: actorDisabled,
    ...(session_id_hash !== undefined ? { session_id_hash } : {}),
    ...(expires_at !== undefined ? { expires_at } : {}),
  };
}

/**
 * Implémentation AuthPrincipalResolver basée sur Supabase Auth.
 */
export class SupabaseAuthPrincipalResolver implements AuthPrincipalResolver {
  private readonly supabase: GatewayUserSupabaseClient;
  private readonly expectedIssuer: string;
  private readonly expectedAudience: string | undefined;

  constructor(deps: SupabaseAuthPrincipalResolverDeps) {
    this.supabase = deps.supabase;
    this.expectedIssuer = buildExpectedSupabaseIssuer(deps.supabaseUrl);
    this.expectedAudience = deps.expectedAudience;
  }

  async resolvePrincipal(
    input: ResolvePrincipalInput,
  ): Promise<ResolvePrincipalResult> {
    if (!input.authMaterial.credential_present) {
      return { outcome: "unauthenticated" };
    }

    const bearer = input.authMaterial.bearer_token?.trim();
    const hasBearer = Boolean(bearer);

    let user: User | null = null;
    try {
      const response = hasBearer
        ? await this.supabase.auth.getUser(bearer)
        : await this.supabase.auth.getUser();

      if (response.error || !response.data.user) {
        return classifyAuthFailure(response.error);
      }
      user = response.data.user;
    } catch (error) {
      return classifyAuthFailure(error);
    }

    if (!user.id) {
      return { outcome: "invalid_token" };
    }

    let expires_at: string | undefined;
    let sessionHash = input.authMaterial.session_id_hash;

    if (hasBearer && bearer) {
      const claims = decodeJwtPayload(bearer);
      if (!claims) {
        return { outcome: "invalid_token" };
      }

      const validated = validateUserJwtClaims({
        claims,
        now: input.now,
        expectedIssuer: this.expectedIssuer,
        ...(this.expectedAudience !== undefined
          ? { expectedAudience: this.expectedAudience }
          : {}),
      });

      if (!validated.ok) {
        return { outcome: validated.reason };
      }

      expires_at = validated.expires_at;
      if (
        sessionHash === undefined &&
        typeof validated.claims.session_id === "string" &&
        validated.claims.session_id.length > 0
      ) {
        sessionHash = hashOpaque(validated.claims.session_id);
      } else if (sessionHash === undefined) {
        // Empreinte opaque du Bearer — jamais le token brut dans le principal.
        sessionHash = hashOpaque(bearer);
      }

      if (
        typeof validated.claims.sub === "string" &&
        validated.claims.sub.length > 0 &&
        validated.claims.sub !== user.id
      ) {
        return { outcome: "invalid_token" };
      }
    }

    const principal = toPrincipal({
      user,
      authentication_method: hasBearer
        ? "supabase_auth_jwt"
        : "supabase_auth_session",
      now: input.now,
      ...(sessionHash !== undefined ? { session_id_hash: sessionHash } : {}),
      ...(expires_at !== undefined ? { expires_at } : {}),
    });

    if (principal.actor_disabled === true) {
      return { outcome: "actor_disabled" };
    }

    return { outcome: "authenticated", principal };
  }
}

export function createSupabaseAuthPrincipalResolver(
  deps: SupabaseAuthPrincipalResolverDeps,
): AuthPrincipalResolver {
  return new SupabaseAuthPrincipalResolver(deps);
}
