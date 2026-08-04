/**
 * Diagnostic LLM pour /api/health.
 *
 * Ne rend JAMAIS de valeur de clé : uniquement des booléens de présence.
 * Ne lève jamais : une config invalide est un état rapporté, pas un crash
 * de la sonde de santé.
 */

import "server-only";

import { loadLlmEnv, type LlmEnv, type LlmProviderId } from "./env";

export type LlmHealthMode = "disabled" | "stub" | "live" | "misconfigured";

export type LlmHealthReport = {
  enabled: boolean;
  mode: LlmHealthMode;
  provider: LlmProviderId | null;
  model: string | null;
  api_key_present: boolean;
  fallback_provider: LlmProviderId | null;
  fallback_model: string | null;
  fallback_api_key_present: boolean;
  streaming: boolean;
};

const MISCONFIGURED: LlmHealthReport = {
  enabled: false,
  mode: "misconfigured",
  provider: null,
  model: null,
  api_key_present: false,
  fallback_provider: null,
  fallback_model: null,
  fallback_api_key_present: false,
  streaming: false,
};

export function describeLlmHealth(env?: LlmEnv): LlmHealthReport {
  let resolved: LlmEnv;
  try {
    resolved = env ?? loadLlmEnv();
  } catch {
    // Message d'origine volontairement non propagé : il peut nommer des
    // variables d'environnement, la sonde reste muette sur le détail.
    return MISCONFIGURED;
  }

  const primary = resolved.providers[resolved.provider];
  const fallback = resolved.fallbackProvider
    ? resolved.providers[resolved.fallbackProvider]
    : undefined;

  return {
    enabled: resolved.enabled,
    mode: resolved.mode,
    provider: resolved.provider,
    model: primary.model,
    api_key_present: Boolean(primary.apiKey),
    fallback_provider: resolved.fallbackProvider ?? null,
    fallback_model: fallback?.model ?? null,
    fallback_api_key_present: Boolean(fallback?.apiKey),
    streaming: resolved.streaming,
  };
}
