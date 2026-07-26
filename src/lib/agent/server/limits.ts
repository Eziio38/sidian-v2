/**
 * Limites et timeouts injectés du Server Route Adapter (G1-L).
 *
 * Toutes les bornes vivent ici — aucune valeur magique dispersée
 * dans request-adapter / route-handler.
 */

/**
 * Bornes par défaut (documentées, raisonnables pour un POST outil JSON) :
 * - `max_body_bytes` : 256 KiB — arguments outil, pas d’upload ;
 * - `gateway_timeout_ms` : 5 s — résolution auth + membership ;
 * - `router_timeout_ms` : 25 s — orchestration + exécuteur ;
 * - `total_timeout_ms` : 30 s — budget global de la requête HTTP.
 */
export const DEFAULT_AGENT_SERVER_LIMITS = {
  max_body_bytes: 256 * 1024,
  gateway_timeout_ms: 5_000,
  router_timeout_ms: 25_000,
  total_timeout_ms: 30_000,
} as const satisfies AgentServerLimits;

export type AgentServerLimits = {
  /** Taille max du corps brut (octets). */
  max_body_bytes: number;
  /** Timeout Gateway (ms) — résolution auth / membership. */
  gateway_timeout_ms: number;
  /** Timeout Router (ms) — orchestration outil. */
  router_timeout_ms: number;
  /** Budget total HTTP (ms) — empêche de démarrer une étape déjà hors délai. */
  total_timeout_ms: number;
};

export type AgentServerLimitsInput = Partial<AgentServerLimits>;

function assertPositiveInt(name: keyof AgentServerLimits, value: number): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(
      `AgentServerLimits.${name} must be a positive integer (got ${String(value)})`,
    );
  }
}

/**
 * Fusionne les limites fournies avec les défauts documentés.
 * Valide que chaque borne est un entier strictement positif.
 */
export function resolveAgentServerLimits(
  input?: AgentServerLimitsInput,
): AgentServerLimits {
  const resolved: AgentServerLimits = {
    max_body_bytes:
      input?.max_body_bytes ?? DEFAULT_AGENT_SERVER_LIMITS.max_body_bytes,
    gateway_timeout_ms:
      input?.gateway_timeout_ms ??
      DEFAULT_AGENT_SERVER_LIMITS.gateway_timeout_ms,
    router_timeout_ms:
      input?.router_timeout_ms ?? DEFAULT_AGENT_SERVER_LIMITS.router_timeout_ms,
    total_timeout_ms:
      input?.total_timeout_ms ?? DEFAULT_AGENT_SERVER_LIMITS.total_timeout_ms,
  };

  assertPositiveInt("max_body_bytes", resolved.max_body_bytes);
  assertPositiveInt("gateway_timeout_ms", resolved.gateway_timeout_ms);
  assertPositiveInt("router_timeout_ms", resolved.router_timeout_ms);
  assertPositiveInt("total_timeout_ms", resolved.total_timeout_ms);

  if (resolved.total_timeout_ms < resolved.gateway_timeout_ms) {
    throw new Error(
      "AgentServerLimits.total_timeout_ms must be >= gateway_timeout_ms",
    );
  }

  return resolved;
}
