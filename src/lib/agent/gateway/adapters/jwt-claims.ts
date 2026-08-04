/**
 * Lecture défensive des claims JWT **après** vérification Auth officielle.
 *
 * Ne remplace PAS `auth.getUser(jwt)` : pas de vérif de signature ici.
 * Sert uniquement à :
 * - contrôler issuer / audience applicatifs ;
 * - refuser les JWT `service_role` / `anon` ;
 * - extraire `exp` pour comparaison à l’horloge injectée.
 */

import {
  SUPABASE_ANON_ROLE_CLAIM,
  SUPABASE_AUTH_AUDIENCE,
  SUPABASE_SERVICE_ROLE_CLAIM,
} from "./constants";

export type JwtPayloadClaims = {
  sub?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  role?: string;
  session_id?: string;
};

function decodeBase64UrlJson(segment: string): unknown {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4;
  const padded =
    pad === 0 ? normalized : normalized + "=".repeat(4 - pad);
  const json = Buffer.from(padded, "base64").toString("utf8");
  return JSON.parse(json) as unknown;
}

/**
 * Décode le payload JWT sans vérifier la signature.
 * Retourne null si forme invalide (fail-closed côté appelant).
 */
export function decodeJwtPayload(jwt: string): JwtPayloadClaims | null {
  const trimmed = jwt.trim();
  if (!trimmed || trimmed.length > 8192) {
    return null;
  }
  const parts = trimmed.split(".");
  if (parts.length < 2 || !parts[1]) {
    return null;
  }
  try {
    const payload = decodeBase64UrlJson(parts[1]);
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }
    return payload as JwtPayloadClaims;
  } catch {
    return null;
  }
}

export function buildExpectedSupabaseIssuer(supabaseUrl: string): string {
  const base = supabaseUrl.trim().replace(/\/$/, "");
  return `${base}/auth/v1`;
}

function audiencesInclude(
  aud: string | string[] | undefined,
  expected: string,
): boolean {
  if (aud === undefined) {
    return false;
  }
  if (typeof aud === "string") {
    return aud === expected;
  }
  return aud.includes(expected);
}

export type JwtClaimsValidation =
  | { ok: true; claims: JwtPayloadClaims; expires_at?: string }
  | {
      ok: false;
      reason:
        | "invalid_token"
        | "expired_token"
        | "issuer_mismatch"
        | "audience_mismatch";
    };

/**
 * Contrôles applicatifs sur claims déjà obtenus via getUser.
 * Refuse service_role / anon comme identité utilisateur final.
 */
export function validateUserJwtClaims(params: {
  claims: JwtPayloadClaims;
  now: string;
  expectedIssuer: string;
  expectedAudience?: string;
}): JwtClaimsValidation {
  const {
    claims,
    now,
    expectedIssuer,
    expectedAudience = SUPABASE_AUTH_AUDIENCE,
  } = params;

  const role = typeof claims.role === "string" ? claims.role : undefined;
  if (
    role === SUPABASE_SERVICE_ROLE_CLAIM ||
    role === SUPABASE_ANON_ROLE_CLAIM
  ) {
    return { ok: false, reason: "invalid_token" };
  }

  if (typeof claims.iss === "string" && claims.iss.length > 0) {
    if (claims.iss !== expectedIssuer) {
      return { ok: false, reason: "issuer_mismatch" };
    }
  }

  if (claims.aud !== undefined) {
    if (!audiencesInclude(claims.aud, expectedAudience)) {
      return { ok: false, reason: "audience_mismatch" };
    }
  }

  let expires_at: string | undefined;
  if (typeof claims.exp === "number" && Number.isFinite(claims.exp)) {
    expires_at = new Date(claims.exp * 1000).toISOString();
    const nowMs = Date.parse(now);
    if (!Number.isFinite(nowMs) || nowMs >= claims.exp * 1000) {
      return { ok: false, reason: "expired_token" };
    }
  }

  return {
    ok: true,
    claims,
    ...(expires_at !== undefined ? { expires_at } : {}),
  };
}
