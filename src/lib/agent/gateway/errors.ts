/**
 * Codes d’erreur Request Gateway (G1-K).
 * Messages applicatifs stables — jamais de JWT brut, cookie, SQL, stack ou secret.
 */

export const GATEWAY_ERROR_CODES = [
  "GATEWAY_INPUT_INVALID",
  "AUTHENTICATION_REQUIRED",
  "AUTH_TOKEN_INVALID",
  "AUTH_TOKEN_EXPIRED",
  "AUTH_ISSUER_MISMATCH",
  "AUTH_AUDIENCE_MISMATCH",
  "ACTOR_NOT_FOUND",
  "ACTOR_DISABLED",
  "TENANT_NOT_FOUND",
  "TENANT_MEMBERSHIP_REQUIRED",
  "TENANT_MEMBERSHIP_INACTIVE",
  "TENANT_SCOPE_INVALID",
  "TRUST_CONTEXT_BUILD_FAILED",
  "AUTH_SERVICE_UNAVAILABLE",
] as const;

export type GatewayErrorCode = (typeof GATEWAY_ERROR_CODES)[number];

export const GATEWAY_ERROR_CATEGORIES = [
  "input",
  "authentication",
  "authorization",
  "unavailable",
] as const;

export type GatewayErrorCategory = (typeof GATEWAY_ERROR_CATEGORIES)[number];

/** Messages sûrs exposables — aucun détail fournisseur / token / stack. */
export const GATEWAY_SAFE_MESSAGES = {
  GATEWAY_INPUT_INVALID:
    "Requête gateway invalide ou champs interdits (schéma strict).",
  AUTHENTICATION_REQUIRED: "Authentification requise.",
  AUTH_TOKEN_INVALID: "Jeton d’authentification invalide.",
  AUTH_TOKEN_EXPIRED: "Jeton d’authentification expiré.",
  AUTH_ISSUER_MISMATCH: "Émetteur du jeton non reconnu.",
  AUTH_AUDIENCE_MISMATCH: "Audience du jeton non reconnue.",
  ACTOR_NOT_FOUND: "Acteur introuvable.",
  ACTOR_DISABLED: "Acteur désactivé.",
  TENANT_NOT_FOUND: "Tenant introuvable.",
  TENANT_MEMBERSHIP_REQUIRED: "Appartenance au tenant requise.",
  TENANT_MEMBERSHIP_INACTIVE: "Appartenance au tenant inactive.",
  TENANT_SCOPE_INVALID: "Portée tenant invalide ou ambiguë.",
  TRUST_CONTEXT_BUILD_FAILED:
    "Échec de construction du contexte d’exécution de confiance.",
  AUTH_SERVICE_UNAVAILABLE: "Service d’authentification indisponible.",
} as const satisfies Record<GatewayErrorCode, string>;

export const GATEWAY_ERROR_CATEGORY_BY_CODE = {
  GATEWAY_INPUT_INVALID: "input",
  AUTHENTICATION_REQUIRED: "authentication",
  AUTH_TOKEN_INVALID: "authentication",
  AUTH_TOKEN_EXPIRED: "authentication",
  AUTH_ISSUER_MISMATCH: "authentication",
  AUTH_AUDIENCE_MISMATCH: "authentication",
  ACTOR_NOT_FOUND: "authorization",
  ACTOR_DISABLED: "authorization",
  TENANT_NOT_FOUND: "authorization",
  TENANT_MEMBERSHIP_REQUIRED: "authorization",
  TENANT_MEMBERSHIP_INACTIVE: "authorization",
  TENANT_SCOPE_INVALID: "authorization",
  TRUST_CONTEXT_BUILD_FAILED: "unavailable",
  AUTH_SERVICE_UNAVAILABLE: "unavailable",
} as const satisfies Record<GatewayErrorCode, GatewayErrorCategory>;

/**
 * Décisions de résolution gateway (hors échec de schéma d’entrée).
 * Alignées sur le brief G1-K.
 */
export const GATEWAY_DECISIONS = [
  "authenticated",
  "unauthenticated",
  "invalid_token",
  "expired_token",
  "issuer_mismatch",
  "audience_mismatch",
  "tenant_membership_missing",
  "tenant_membership_inactive",
  "tenant_ambiguous",
  "actor_disabled",
  "unavailable",
] as const;

export type GatewayDecision = (typeof GATEWAY_DECISIONS)[number];

export type GatewayDenialDecision = Exclude<
  GatewayDecision,
  "authenticated"
>;

/** Mapping décision → code d’erreur exposable. */
export const GATEWAY_ERROR_CODE_BY_DECISION = {
  unauthenticated: "AUTHENTICATION_REQUIRED",
  invalid_token: "AUTH_TOKEN_INVALID",
  expired_token: "AUTH_TOKEN_EXPIRED",
  issuer_mismatch: "AUTH_ISSUER_MISMATCH",
  audience_mismatch: "AUTH_AUDIENCE_MISMATCH",
  tenant_membership_missing: "TENANT_MEMBERSHIP_REQUIRED",
  tenant_membership_inactive: "TENANT_MEMBERSHIP_INACTIVE",
  tenant_ambiguous: "TENANT_SCOPE_INVALID",
  actor_disabled: "ACTOR_DISABLED",
  unavailable: "AUTH_SERVICE_UNAVAILABLE",
} as const satisfies Record<GatewayDenialDecision, GatewayErrorCode>;

export type GatewayErrorDescriptor = {
  code: GatewayErrorCode;
  category: GatewayErrorCategory;
  message: string;
};

export function gatewayErrorDescriptor(
  code: GatewayErrorCode,
  message?: string,
): GatewayErrorDescriptor {
  return {
    code,
    category: GATEWAY_ERROR_CATEGORY_BY_CODE[code],
    message: message ?? GATEWAY_SAFE_MESSAGES[code],
  };
}

export function gatewayErrorFromDecision(
  decision: GatewayDenialDecision,
): GatewayErrorDescriptor {
  return gatewayErrorDescriptor(GATEWAY_ERROR_CODE_BY_DECISION[decision]);
}

export class GatewayError extends Error {
  readonly code: GatewayErrorCode;
  readonly category: GatewayErrorCategory;

  constructor(code: GatewayErrorCode, message?: string) {
    super(message ?? GATEWAY_SAFE_MESSAGES[code]);
    this.name = "GatewayError";
    this.code = code;
    this.category = GATEWAY_ERROR_CATEGORY_BY_CODE[code];
  }

  toDescriptor(): GatewayErrorDescriptor {
    return {
      code: this.code,
      category: this.category,
      message: this.message,
    };
  }
}
