/**
 * Validation / sanitization du principal authentifié (G1-K).
 * Aucune I/O — le resolver (adapters) fournit le principal ; ici on
 * refuse les formes invalides et les champs sensibles.
 */

import { GatewayError } from "./errors";
import { authenticatedPrincipalSchema } from "./schemas";
import type { AuthenticatedPrincipal } from "./types";

/** Clés sensibles jamais acceptées sur un principal. */
const PRINCIPAL_FORBIDDEN_KEYS = [
  "jwt",
  "access_token",
  "refresh_token",
  "authorization",
  "cookie",
  "session_token",
  "raw_claims",
  "claims",
  "password",
  "secret",
  "private_key",
  "service_role",
] as const;

function hasForbiddenPrincipalKey(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  for (const forbidden of PRINCIPAL_FORBIDDEN_KEYS) {
    if (keys.includes(forbidden)) {
      return true;
    }
  }
  return false;
}

/**
 * Valide et normalise un principal issu du resolver.
 * Fail-closed : forme invalide ou champ sensible → GatewayError.
 */
export function sanitizeAuthenticatedPrincipal(
  raw: unknown,
): AuthenticatedPrincipal {
  if (hasForbiddenPrincipalKey(raw)) {
    throw new GatewayError("TRUST_CONTEXT_BUILD_FAILED");
  }

  const parsed = authenticatedPrincipalSchema.safeParse(raw);
  if (!parsed.success) {
    throw new GatewayError("TRUST_CONTEXT_BUILD_FAILED");
  }

  const principal = parsed.data;

  if (principal.actor_disabled === true) {
    throw new GatewayError("ACTOR_DISABLED");
  }

  return {
    principal_subject: principal.principal_subject,
    actor_id: principal.actor_id,
    actor_type: principal.actor_type,
    authentication_method: principal.authentication_method,
    ...(principal.authenticated_at !== undefined
      ? { authenticated_at: principal.authenticated_at }
      : {}),
    ...(principal.session_id_hash !== undefined
      ? { session_id_hash: principal.session_id_hash }
      : {}),
    ...(principal.expires_at !== undefined
      ? { expires_at: principal.expires_at }
      : {}),
    ...(principal.email_confirmed !== undefined
      ? { email_confirmed: principal.email_confirmed }
      : {}),
    ...(principal.actor_disabled !== undefined
      ? { actor_disabled: principal.actor_disabled }
      : {}),
  };
}

/**
 * Vérifie l’expiration du principal contre l’horloge injectée.
 * Retourne true si expiré ou si l’horloge / expires_at est indéterminable
 * alors qu’expires_at est présent (fail-closed).
 */
export function isPrincipalExpired(
  principal: AuthenticatedPrincipal,
  now: string,
): boolean {
  if (principal.expires_at === undefined) {
    return false;
  }
  const expMs = Date.parse(principal.expires_at);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(expMs) || !Number.isFinite(nowMs)) {
    return true;
  }
  return nowMs >= expMs;
}
