/**
 * Empreintes d’intention pour validations humaines (G1-H).
 * Réutilise exclusivement la logique canonique G1-G — aucune implémentation divergente.
 */

import { createHash } from "node:crypto";

import {
  buildCanonicalFingerprintPayload,
  buildRequestFingerprint,
  canonicalizeForFingerprint,
  hashOwnerToken,
  hashTerminalResult,
} from "@/lib/agent/idempotency";
import type { IdempotencyFingerprintSource } from "@/lib/agent/idempotency";

export {
  buildCanonicalFingerprintPayload,
  buildRequestFingerprint,
  canonicalizeForFingerprint,
  hashOwnerToken,
  hashTerminalResult,
};

export type ApprovalFingerprintSource = IdempotencyFingerprintSource;

/**
 * Hash SHA-256 hex des paramètres métier (arguments déjà validés).
 * Distinct du request_fingerprint (intention complète tenant/outil/mode/…).
 * Aucun argument brut n’est persisté — seul ce hash l’est.
 */
export function buildParamsHash(argumentsValue: unknown): string {
  const canonical = canonicalizeForFingerprint(argumentsValue);
  return createHash("sha256")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex");
}

/** Hash SHA-256 hex d’une clé d’idempotence — seul le hash part vers consume. */
export function hashIdempotencyKey(idempotencyKey: string): string {
  return createHash("sha256").update(idempotencyKey, "utf8").digest("hex");
}
