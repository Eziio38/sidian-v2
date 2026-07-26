/**
 * G1-M — erreurs domaine protection draft (messages sûrs, pas de secrets).
 */

export const PROTECTION_DRAFT_ERROR_CODES = [
  "PROTECTION_DRAFT_INPUT_INVALID",
  "PROTECTION_DRAFT_NOT_FOUND",
  "PROTECTION_DRAFT_EXPIRED",
  "PROTECTION_DRAFT_CANCELLED",
  "PROTECTION_DRAFT_NOT_READY",
  "PROTECTION_DRAFT_CONFIRMATION_REQUIRED",
  "PROTECTION_DRAFT_CONFIRMATION_MISMATCH",
  "PROTECTION_DRAFT_MISSING_FIELDS",
  "PROTECTION_DRAFT_AMBIGUITIES_OPEN",
  "PROTECTION_DRAFT_VALIDATION_FAILED",
  "PROTECTION_DRAFT_TENANT_MISMATCH",
  "PROTECTION_DRAFT_IDEMPOTENCY_CONFLICT",
  "PROTECTION_DRAFT_UNAVAILABLE",
  "PROTECTION_DRAFT_NOT_CONFIRMABLE",
] as const;

export type ProtectionDraftErrorCode =
  (typeof PROTECTION_DRAFT_ERROR_CODES)[number];

const SAFE_MESSAGES: Record<ProtectionDraftErrorCode, string> = {
  PROTECTION_DRAFT_INPUT_INVALID: "La demande de brouillon est invalide.",
  PROTECTION_DRAFT_NOT_FOUND: "Brouillon introuvable.",
  PROTECTION_DRAFT_EXPIRED: "Ce brouillon a expiré.",
  PROTECTION_DRAFT_CANCELLED: "Ce brouillon a été annulé.",
  PROTECTION_DRAFT_NOT_READY:
    "Le brouillon n’est pas prêt pour confirmation.",
  PROTECTION_DRAFT_CONFIRMATION_REQUIRED:
    "Une confirmation explicite est requise.",
  PROTECTION_DRAFT_CONFIRMATION_MISMATCH:
    "La confirmation ne correspond pas au récapitulatif.",
  PROTECTION_DRAFT_MISSING_FIELDS:
    "Des informations obligatoires manquent encore.",
  PROTECTION_DRAFT_AMBIGUITIES_OPEN:
    "Des informations ambiguës doivent être confirmées.",
  PROTECTION_DRAFT_VALIDATION_FAILED:
    "Une valeur fournie est invalide.",
  PROTECTION_DRAFT_TENANT_MISMATCH: "Accès refusé.",
  PROTECTION_DRAFT_IDEMPOTENCY_CONFLICT:
    "Conflit d’idempotence sur la création.",
  PROTECTION_DRAFT_UNAVAILABLE:
    "Le service de brouillon est indisponible.",
  PROTECTION_DRAFT_NOT_CONFIRMABLE:
    "Ce brouillon ne peut plus être confirmé.",
};

export class ProtectionDraftError extends Error {
  readonly code: ProtectionDraftErrorCode;
  readonly category: "business" | "technical";
  readonly userMessage: string;

  constructor(
    code: ProtectionDraftErrorCode,
    options?: { category?: "business" | "technical"; message?: string },
  ) {
    super(options?.message ?? SAFE_MESSAGES[code]);
    this.name = "ProtectionDraftError";
    this.code = code;
    this.category = options?.category ?? "business";
    this.userMessage = SAFE_MESSAGES[code];
  }
}

export function isProtectionDraftError(
  value: unknown,
): value is ProtectionDraftError {
  return value instanceof ProtectionDraftError;
}
