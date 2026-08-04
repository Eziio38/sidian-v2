/**
 * Codes d’erreur HTTP du Server Route Adapter (G1-L).
 * Messages applicatifs stables — jamais de JWT, cookie, SQL, stack ou secret.
 */

export const AGENT_SERVER_ERROR_CODES = [
  "HTTP_METHOD_NOT_ALLOWED",
  "HTTP_CONTENT_TYPE_REQUIRED",
  "HTTP_CONTENT_TYPE_UNSUPPORTED",
  "HTTP_BODY_INVALID",
  "HTTP_BODY_TOO_LARGE",
  "HTTP_REQUEST_INVALID",
  "HTTP_REQUEST_TIMEOUT",
  "AUTHENTICATION_REQUIRED",
  "AUTHENTICATION_INVALID",
  "TENANT_ACCESS_DENIED",
  "AGENT_ROUTE_FAILED",
  "AGENT_DEPENDENCY_UNAVAILABLE",
  "INTERNAL_SERVER_ERROR",
] as const;

export type AgentServerErrorCode = (typeof AGENT_SERVER_ERROR_CODES)[number];

/** Messages sûrs exposables — aucun détail fournisseur / token / stack. */
export const AGENT_SERVER_SAFE_MESSAGES = {
  HTTP_METHOD_NOT_ALLOWED: "Méthode HTTP non autorisée.",
  HTTP_CONTENT_TYPE_REQUIRED: "Content-Type requis.",
  HTTP_CONTENT_TYPE_UNSUPPORTED: "Content-Type non supporté.",
  HTTP_BODY_INVALID: "Corps de requête JSON invalide.",
  HTTP_BODY_TOO_LARGE: "Corps de requête trop volumineux.",
  HTTP_REQUEST_INVALID: "Requête agent invalide.",
  HTTP_REQUEST_TIMEOUT: "Délai de traitement de la requête dépassé.",
  AUTHENTICATION_REQUIRED: "Authentification requise.",
  AUTHENTICATION_INVALID: "Authentification invalide.",
  TENANT_ACCESS_DENIED: "Accès au tenant refusé.",
  AGENT_ROUTE_FAILED: "Échec du routage agent.",
  AGENT_DEPENDENCY_UNAVAILABLE: "Dépendance agent indisponible.",
  INTERNAL_SERVER_ERROR: "Erreur interne du serveur.",
} as const satisfies Record<AgentServerErrorCode, string>;

export type AgentServerHttpStatus =
  | "success"
  | "blocked"
  | "pending"
  | "error";

export type AgentServerErrorDescriptor = {
  code: AgentServerErrorCode;
  message: string;
};

export function agentServerErrorDescriptor(
  code: AgentServerErrorCode,
  message?: string,
): AgentServerErrorDescriptor {
  return {
    code,
    message: message ?? AGENT_SERVER_SAFE_MESSAGES[code],
  };
}

/**
 * Erreur contrôlée du Server Route Adapter — jamais exposée brute au client.
 * Traduite exclusivement via `response-adapter`.
 */
export class AgentServerError extends Error {
  readonly code: AgentServerErrorCode;
  readonly httpStatus: number;

  constructor(
    code: AgentServerErrorCode,
    httpStatus: number,
    message?: string,
  ) {
    super(message ?? AGENT_SERVER_SAFE_MESSAGES[code]);
    this.name = "AgentServerError";
    this.code = code;
    this.httpStatus = httpStatus;
  }

  toDescriptor(): AgentServerErrorDescriptor {
    return agentServerErrorDescriptor(this.code, this.message);
  }
}
