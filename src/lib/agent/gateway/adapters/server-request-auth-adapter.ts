/**
 * ServerRequestAuthAdapter — extrait AuthMaterial + métadonnées depuis
 * la requête HTTP serveur (headers / cookies), **jamais depuis le body**.
 *
 * - Bearer `Authorization` → credential JWT ;
 * - cookies Supabase `sb-*-auth-token` → credential session (sans lire le body) ;
 * - `x-sidian-tenant-id` (et alias) → hint tenant **non fiable** ;
 * - aucun champ session / JWT / tenant depuis un JSON body.
 */

import { createHash, randomUUID } from "node:crypto";

import type {
  AuthMaterial,
  GatewayRequestMetadata,
} from "@/lib/agent/gateway/types";

import {
  CORRELATION_ID_HEADER,
  REQUEST_ID_HEADER,
  SIDIAN_TENANT_ID_HEADER,
  SIDIAN_TENANT_ID_HEADER_ALIASES,
  SUPABASE_AUTH_COOKIE_PREFIX,
  SUPABASE_AUTH_COOKIE_SUFFIX,
} from "./constants";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const BEARER_RE = /^Bearer\s+(\S+)$/i;

export type ServerRequestAuthHeaders =
  | Headers
  | Readonly<Record<string, string | string[] | null | undefined>>;

export type ServerRequestAuthAdapterInput = {
  headers: ServerRequestAuthHeaders;
  /**
   * Cookie header brut optionnel (si non présent dans `headers`).
   * Jamais un body JSON.
   */
  cookieHeader?: string;
  /** Identifiant fourni par l’edge — sinon généré serveur. */
  request_id?: string;
  correlation_id?: string;
};

export type ServerRequestAuthAdapterResult = {
  authMaterial: AuthMaterial;
  requestMetadata: GatewayRequestMetadata;
};

function readHeader(
  headers: ServerRequestAuthHeaders,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  if (headers instanceof Headers) {
    const value = headers.get(name) ?? headers.get(lower);
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
  }

  const raw = headers[name] ?? headers[lower];
  if (Array.isArray(raw)) {
    const first = raw[0]?.trim();
    return first && first.length > 0 ? first : undefined;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

function extractBearerToken(
  authorization: string | undefined,
): string | undefined {
  if (!authorization) {
    return undefined;
  }
  const match = authorization.trim().match(BEARER_RE);
  if (!match?.[1]) {
    return undefined;
  }
  return match[1];
}

function parseCookieHeader(
  cookieHeader: string | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!cookieHeader) {
    return map;
  }
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!name || !value) continue;
    map.set(name, value);
  }
  return map;
}

function findSupabaseAuthCookieValue(
  cookies: Map<string, string>,
): string | undefined {
  for (const [name, value] of cookies) {
    if (
      name.startsWith(SUPABASE_AUTH_COOKIE_PREFIX) &&
      name.endsWith(SUPABASE_AUTH_COOKIE_SUFFIX) &&
      value.length > 0
    ) {
      return value;
    }
  }
  // Chunked cookies Supabase : `sb-xxx-auth-token.0`, `.1`, …
  const chunkNames = [...cookies.keys()]
    .filter(
      (name) =>
        name.startsWith(SUPABASE_AUTH_COOKIE_PREFIX) &&
        name.includes(SUPABASE_AUTH_COOKIE_SUFFIX),
    )
    .sort();
  if (chunkNames.length === 0) {
    return undefined;
  }
  const joined = chunkNames.map((n) => cookies.get(n) ?? "").join("");
  return joined.length > 0 ? joined : undefined;
}

function hashOpaque(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function readRequestedTenantId(
  headers: ServerRequestAuthHeaders,
): string | undefined {
  const candidates = [
    SIDIAN_TENANT_ID_HEADER,
    ...SIDIAN_TENANT_ID_HEADER_ALIASES,
  ];
  for (const name of candidates) {
    const value = readHeader(headers, name);
    if (value && UUID_RE.test(value)) {
      return value.toLowerCase();
    }
  }
  return undefined;
}

/**
 * Adapter serveur : headers/cookies → AuthMaterial + GatewayRequestMetadata.
 *
 * Ne lit **aucun** body. Un tenant header invalide (non-UUID) est ignoré
 * (pas injecté comme hint) — le gateway traitera l’absence ou l’ambiguïté.
 */
export class ServerRequestAuthAdapter {
  extract(
    input: ServerRequestAuthAdapterInput,
  ): ServerRequestAuthAdapterResult {
    const authorization = readHeader(input.headers, "authorization");
    const bearer = extractBearerToken(authorization);

    const cookieHeader =
      input.cookieHeader ?? readHeader(input.headers, "cookie");
    const cookies = parseCookieHeader(cookieHeader);
    const authCookieValue = findSupabaseAuthCookieValue(cookies);

    const credentialPresent = Boolean(bearer) || Boolean(authCookieValue);

    let session_id_hash: string | undefined;
    if (bearer) {
      session_id_hash = hashOpaque(bearer);
    } else if (authCookieValue) {
      // Hash du cookie session — jamais le cookie brut dans AuthMaterial.
      session_id_hash = hashOpaque(authCookieValue);
    }

    const authMaterial: AuthMaterial = {
      credential_present: credentialPresent,
      ...(bearer ? { bearer_token: bearer } : {}),
      ...(session_id_hash !== undefined ? { session_id_hash } : {}),
    };

    const request_id =
      input.request_id?.trim() ||
      readHeader(input.headers, REQUEST_ID_HEADER) ||
      randomUUID();

    const correlation_id =
      input.correlation_id?.trim() ||
      readHeader(input.headers, CORRELATION_ID_HEADER);

    const requested_tenant_id = readRequestedTenantId(input.headers);

    const requestMetadata: GatewayRequestMetadata = {
      request_id,
      ...(correlation_id !== undefined ? { correlation_id } : {}),
      ...(requested_tenant_id !== undefined ? { requested_tenant_id } : {}),
    };

    return { authMaterial, requestMetadata };
  }
}

export function createServerRequestAuthAdapter(): ServerRequestAuthAdapter {
  return new ServerRequestAuthAdapter();
}

/**
 * Helper : extrait directement le matériel auth (API fonctionnelle).
 */
export function extractServerRequestAuth(
  input: ServerRequestAuthAdapterInput,
): ServerRequestAuthAdapterResult {
  return new ServerRequestAuthAdapter().extract(input);
}
