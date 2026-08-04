/**
 * Taxonomie d'erreurs partagée par TOUS les transports live.
 *
 * Un seul mapping statut HTTP → LlmError : deux providers ne peuvent pas
 * diverger sur la classification (retryable / non retryable), sinon la
 * bascule de secours se déclencherait sur des cas différents selon le
 * provider primaire.
 *
 * Aucun corps de réponse provider n'est repris dans le message : seul le
 * statut est exposé, donc jamais de clé ni de contenu utilisateur.
 */

import { LlmError } from "../errors";

export function isAbortError(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === "AbortError") ||
    (typeof DOMException !== "undefined" &&
      err instanceof DOMException &&
      err.name === "AbortError")
  );
}

/**
 * Statut HTTP → erreur typée.
 *
 * 4xx hors 401/403/429 est classé `LLM_LIVE_MISCONFIGURED` (non retryable) :
 * un modèle inconnu ou un paramètre refusé ne changera pas au réessai, et
 * basculer sur le provider de secours masquerait une erreur de configuration.
 */
export function classifyLlmHttpStatus(status: number): LlmError {
  if (status === 401 || status === 403) {
    return new LlmError("LLM_PROVIDER_AUTH", { message: `llm_http_${status}` });
  }
  if (status === 429) {
    return new LlmError("LLM_PROVIDER_RATE_LIMITED", {
      message: "llm_rate_limited",
    });
  }
  if (status >= 500) {
    return new LlmError("LLM_PROVIDER_ERROR", { message: `llm_http_${status}` });
  }
  if (status >= 400) {
    return new LlmError("LLM_LIVE_MISCONFIGURED", {
      message: `llm_http_${status}`,
    });
  }
  return new LlmError("LLM_PROVIDER_ERROR", { message: `llm_http_${status}` });
}

/**
 * Normalise n'importe quel rejet de transport en LlmError.
 * Une cause non typée reste une erreur provider retryable.
 */
export function normalizeLlmTransportError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  if (isAbortError(err)) {
    return new LlmError("LLM_TIMEOUT", { message: "llm_timeout" });
  }
  return new LlmError("LLM_PROVIDER_ERROR", {
    message: "llm_network_error",
    cause: err,
  });
}
