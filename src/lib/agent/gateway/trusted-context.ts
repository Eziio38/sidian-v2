/**
 * Construction du TrustedExecutionContext (G1-K).
 * Seul le Request Gateway doit appeler ce module.
 * Jamais de JWT brut, token, cookie, claims inutiles ou secret.
 */

import { GatewayError } from "./errors";
import { trustedExecutionContextSchema } from "./schemas";
import type {
  AuthenticatedPrincipal,
  TrustedExecutionContext,
  TrustedRole,
} from "./types";
import { TRUSTED_ROLE_ALLOWLIST } from "./types";

const ROLE_ALLOWLIST = new Set<string>(TRUSTED_ROLE_ALLOWLIST);

/** Clés interdites dans le contexte transmis au Router / audit. */
const CONTEXT_FORBIDDEN_KEYS = [
  "jwt",
  "access_token",
  "refresh_token",
  "authorization",
  "cookie",
  "bearer_token",
  "session_token",
  "raw_claims",
  "claims",
  "password",
  "secret",
  "private_key",
  "service_role",
  "authMaterial",
] as const;

export type BuildTrustedExecutionContextInput = {
  principal: AuthenticatedPrincipal;
  tenant_id: string;
  roles: readonly string[];
  request_id: string;
  correlation_id: string;
  now: string;
};

/**
 * Sanitize les rôles membership → allowlist TrustedRole.
 * Rôles inconnus ignorés ; liste vide → échec fail-closed.
 */
export function sanitizeTrustedRoles(
  roles: readonly string[],
): TrustedRole[] {
  const out: TrustedRole[] = [];
  const seen = new Set<string>();
  for (const role of roles) {
    if (typeof role !== "string") continue;
    const normalized = role.trim().toLowerCase();
    if (!ROLE_ALLOWLIST.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized as TrustedRole);
  }
  return out;
}

function assertNoForbiddenKeys(value: object): void {
  const keys = Object.keys(value);
  for (const forbidden of CONTEXT_FORBIDDEN_KEYS) {
    if (keys.includes(forbidden)) {
      throw new GatewayError("TRUST_CONTEXT_BUILD_FAILED");
    }
  }
}

/**
 * Construit un TrustedExecutionContext déterministe.
 * Horloge = `now` injecté — jamais Date.now().
 */
export function buildTrustedExecutionContext(
  input: BuildTrustedExecutionContextInput,
): TrustedExecutionContext {
  const roles = sanitizeTrustedRoles(input.roles);
  if (roles.length === 0) {
    throw new GatewayError("TRUST_CONTEXT_BUILD_FAILED");
  }

  const candidate: TrustedExecutionContext = {
    tenant_id: input.tenant_id,
    actor_id: input.principal.actor_id,
    actor_type: input.principal.actor_type,
    roles,
    authentication_method: input.principal.authentication_method,
    principal_subject: input.principal.principal_subject,
    trust_level: "authenticated_tenant_member",
    request_id: input.request_id,
    correlation_id: input.correlation_id,
    now: input.now,
    ...(input.principal.authenticated_at !== undefined
      ? { authenticated_at: input.principal.authenticated_at }
      : {}),
    ...(input.principal.session_id_hash !== undefined
      ? { session_id_hash: input.principal.session_id_hash }
      : {}),
  };

  assertNoForbiddenKeys(candidate);

  const parsed = trustedExecutionContextSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new GatewayError("TRUST_CONTEXT_BUILD_FAILED");
  }

  // Copie défensive — pas de mutation de l’entrée / principal.
  return {
    tenant_id: parsed.data.tenant_id,
    actor_id: parsed.data.actor_id,
    actor_type: parsed.data.actor_type,
    roles: [...parsed.data.roles],
    authentication_method: parsed.data.authentication_method,
    principal_subject: parsed.data.principal_subject,
    trust_level: parsed.data.trust_level,
    request_id: parsed.data.request_id,
    correlation_id: parsed.data.correlation_id,
    now: parsed.data.now,
    ...(parsed.data.authenticated_at !== undefined
      ? { authenticated_at: parsed.data.authenticated_at }
      : {}),
    ...(parsed.data.session_id_hash !== undefined
      ? { session_id_hash: parsed.data.session_id_hash }
      : {}),
  };
}
