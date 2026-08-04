/**
 * Codes d’erreur Human Approval Service (G1-H).
 * Messages applicatifs stables — jamais de SQL brut, stack, token ou secret.
 */

export const APPROVAL_ERROR_CODES = [
  "APPROVAL_INPUT_INVALID",
  "APPROVAL_NOT_FOUND",
  "APPROVAL_PENDING",
  "APPROVAL_REJECTED",
  "APPROVAL_EXPIRED",
  "APPROVAL_ALREADY_CONSUMED",
  "APPROVAL_SCOPE_MISMATCH",
  "APPROVAL_PARAMS_MISMATCH",
  "APPROVAL_AUTONOMY_MISMATCH",
  "APPROVAL_NOT_REQUIRED",
  "APPROVAL_UNAVAILABLE",
  "APPROVAL_REQUEST_FAILED",
  "APPROVAL_DECISION_FAILED",
  "APPROVAL_CONSUMPTION_FAILED",
  "APPROVAL_ACTOR_UNAUTHORIZED",
] as const;

export type ApprovalErrorCode = (typeof APPROVAL_ERROR_CODES)[number];

/** Messages sûrs exposables — aucun détail PostgREST / SQL / token. */
export const APPROVAL_SAFE_MESSAGES = {
  APPROVAL_INPUT_INVALID:
    "Entrée d’approbation invalide ou champs interdits (schéma strict).",
  APPROVAL_NOT_FOUND: "Demande d’approbation introuvable.",
  APPROVAL_PENDING: "Demande d’approbation encore en attente de décision.",
  APPROVAL_REJECTED: "Demande d’approbation rejetée.",
  APPROVAL_EXPIRED: "Demande d’approbation expirée.",
  APPROVAL_ALREADY_CONSUMED:
    "Demande d’approbation déjà consommée — rejeu refusé.",
  APPROVAL_SCOPE_MISMATCH:
    "Portée de l’approbation incompatible avec l’intention courante.",
  APPROVAL_PARAMS_MISMATCH:
    "Empreinte des paramètres incompatible avec l’approbation.",
  APPROVAL_AUTONOMY_MISMATCH:
    "Niveau d’autonomie incompatible avec l’approbation.",
  APPROVAL_NOT_REQUIRED: "Validation humaine non requise pour cet outil.",
  APPROVAL_UNAVAILABLE: "Service d’approbation humaine indisponible.",
  APPROVAL_REQUEST_FAILED: "Échec de création de la demande d’approbation.",
  APPROVAL_DECISION_FAILED: "Échec d’enregistrement de la décision humaine.",
  APPROVAL_CONSUMPTION_FAILED: "Échec de consommation atomique de l’approbation.",
  APPROVAL_ACTOR_UNAUTHORIZED:
    "Acteur non autorisé à décider cette approbation.",
} as const satisfies Record<ApprovalErrorCode, string>;

export class ApprovalError extends Error {
  readonly code: ApprovalErrorCode;

  constructor(code: ApprovalErrorCode, message?: string) {
    super(message ?? APPROVAL_SAFE_MESSAGES[code]);
    this.name = "ApprovalError";
    this.code = code;
  }
}
