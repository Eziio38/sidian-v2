/**
 * Codes d’erreur Idempotency Service (G1-G).
 * Messages applicatifs stables — jamais de SQL brut, stack, owner token ou secret.
 */

export const IDEMPOTENCY_ERROR_CODES = [
  "IDEMPOTENCY_INPUT_INVALID",
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_KEY_CONFLICT",
  "IDEMPOTENCY_IN_PROGRESS",
  "IDEMPOTENCY_UNAVAILABLE",
  "IDEMPOTENCY_CLAIM_FAILED",
  "IDEMPOTENCY_COMPLETION_FAILED",
  "IDEMPOTENCY_OWNER_MISMATCH",
  "IDEMPOTENCY_REPLAY_FAILURE",
] as const;

export type IdempotencyErrorCode = (typeof IDEMPOTENCY_ERROR_CODES)[number];

/** Messages sûrs exposables — aucun détail PostgREST / SQL / token. */
export const IDEMPOTENCY_SAFE_MESSAGES = {
  IDEMPOTENCY_INPUT_INVALID:
    "Entrée d’idempotence invalide ou champs interdits (schéma strict).",
  IDEMPOTENCY_KEY_REQUIRED:
    "Clé d’idempotence obligatoire manquante ou vide.",
  IDEMPOTENCY_KEY_CONFLICT:
    "Clé d’idempotence déjà utilisée avec une intention différente.",
  IDEMPOTENCY_IN_PROGRESS:
    "Exécution déjà en cours pour cette clé d’idempotence.",
  IDEMPOTENCY_UNAVAILABLE:
    "Service d’idempotence indisponible.",
  IDEMPOTENCY_CLAIM_FAILED:
    "Échec du claim d’idempotence.",
  IDEMPOTENCY_COMPLETION_FAILED:
    "Échec de finalisation du enregistrement d’idempotence.",
  IDEMPOTENCY_OWNER_MISMATCH:
    "Jeton propriétaire d’idempotence invalide ou obsolète.",
  IDEMPOTENCY_REPLAY_FAILURE:
    "Rejeu d’un échec terminal d’idempotence.",
} as const satisfies Record<IdempotencyErrorCode, string>;

export class IdempotencyError extends Error {
  readonly code: IdempotencyErrorCode;

  constructor(code: IdempotencyErrorCode, message?: string) {
    super(message ?? IDEMPOTENCY_SAFE_MESSAGES[code]);
    this.name = "IdempotencyError";
    this.code = code;
  }
}
