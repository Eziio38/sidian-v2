/**
 * Empreinte canonique d’intention d’exécution (G1-G).
 * Stable : mêmes champs logiques → même fingerprint, indépendamment de l’ordre JSON.
 * Ne mute jamais l’entrée.
 */

import { createHash } from "node:crypto";

import {
  idempotencyFingerprintSourceSchema,
  type ParsedIdempotencyFingerprintSource,
} from "./schemas";
import { IdempotencyError } from "./errors";
import type { IdempotencyFingerprintSource } from "./types";

/**
 * Clés considérées sensibles — omises / rédigées dans la canonicalisation.
 * Couvre secrets, tokens bruts, stacks, données carte / IBAN.
 */
const SENSITIVE_KEY_PATTERN =
  /^(.*[_-]?)?(password|passwd|secret|token|authorization|api[_-]?key|private[_-]?key|pan|iban|card[_-]?number|cvv|cvc|owner[_-]?token|raw[_-]?token|access[_-]?token|refresh[_-]?token|bearer|stack|stacktrace|stack_trace)$/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/**
 * Canonicalise une valeur JSON pour empreinte :
 * - objets : clés triées, valeurs recursives ;
 * - tableaux : ordre conservé (sémantique) ;
 * - clés sensibles → marqueur opaque (pas la valeur) ;
 * - aucun timestamp / correlation injecté ici.
 */
export function canonicalizeForFingerprint(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      return null;
    }
    return value === undefined ? null : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeForFingerprint(item));
  }

  if (!isPlainObject(value)) {
    // Date, Map, etc. — représentation stable opaque (pas de fuite).
    return null;
  }

  const sortedKeys = Object.keys(value).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const out: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    if (isSensitiveKey(key)) {
      out[key] = "<redacted>";
      continue;
    }
    out[key] = canonicalizeForFingerprint(value[key]);
  }
  return out;
}

/**
 * Construit l’objet canonique stable (clés ordonnées) pour hashing.
 * N’inclut pas : now, correlation_id, secrets, token d’approbation brut.
 */
export function buildCanonicalFingerprintPayload(
  source: ParsedIdempotencyFingerprintSource,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    arguments: canonicalizeForFingerprint(source.arguments),
    mode: source.mode,
    requested_autonomy_level: source.requested_autonomy_level,
    tenant_id: source.tenant_id,
    tool_id: source.tool_id,
    tool_version: source.tool_version,
  };

  if (source.resource) {
    payload.resource = {
      kind: source.resource.kind,
      resource_id: source.resource.resource_id,
      tenant_id: source.resource.tenant_id,
    };
  } else {
    payload.resource = null;
  }

  payload.current_params_hash = source.current_params_hash ?? null;
  payload.human_validation_id = source.human_validation_id ?? null;

  // Ordre de clés stable pour JSON.stringify.
  return {
    arguments: payload.arguments,
    current_params_hash: payload.current_params_hash,
    human_validation_id: payload.human_validation_id,
    mode: payload.mode,
    requested_autonomy_level: payload.requested_autonomy_level,
    resource: payload.resource,
    tenant_id: payload.tenant_id,
    tool_id: payload.tool_id,
    tool_version: payload.tool_version,
  };
}

/**
 * Calcule l’empreinte SHA-256 hex (64) de l’intention validée.
 * Déterministe et sans mutation de `source`.
 */
export function buildRequestFingerprint(
  source: IdempotencyFingerprintSource,
): string {
  const parsed = idempotencyFingerprintSourceSchema.safeParse(source);
  if (!parsed.success) {
    throw new IdempotencyError("IDEMPOTENCY_INPUT_INVALID");
  }

  const canonical = buildCanonicalFingerprintPayload(parsed.data);
  return createHash("sha256")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex");
}

/** Hash SHA-256 hex d’un jeton propriétaire — seul le hash est envoyé aux RPC. */
export function hashOwnerToken(ownerToken: string): string {
  return createHash("sha256").update(ownerToken, "utf8").digest("hex");
}

/** Hash SHA-256 hex d’un résultat terminal déjà sanitizé. */
export function hashTerminalResult(terminalResult: unknown): string {
  const canonical = canonicalizeForFingerprint(terminalResult);
  return createHash("sha256")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex");
}
