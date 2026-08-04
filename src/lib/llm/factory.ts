/**
 * Factory LLM depuis env typée — fail-closed si live incomplet.
 */

import "server-only";

import { createLlmBudgetTracker } from "./budget";
import { loadLlmEnv, type LlmEnv, type LlmProviderConfig } from "./env";
import { LlmError } from "./errors";
import {
  InMemoryLlmObservabilitySink,
  NullLlmObservabilitySink,
} from "./observability";
import { createAnthropicMessagesTransport } from "./providers/anthropic-messages";
import {
  createFailoverLlmTransport,
  type LlmFailoverEvent,
} from "./providers/failover";
import { createOpenAiCompatibleTransport } from "./providers/openai-compatible";
import { createStubLlmTransport } from "./providers/stub";
import { createLlmRuntime } from "./runtime";
import type { LlmObservabilitySink, LlmRuntime, LlmTransport } from "./types";

export type CreateLlmRuntimeFromEnvOptions = {
  env?: LlmEnv;
  /** Injecté pour tests (sinon Null). */
  observability?: LlmObservabilitySink;
  /** Transport injecté (bypass stub/live) — tests uniquement. */
  transport?: LlmTransport;
  /** fetch injectable pour le transport live. */
  fetchImpl?: typeof fetch;
  /** Trace du provider ayant servi la requête — injectable pour tests. */
  onProviderServed?: (event: LlmFailoverEvent) => void;
};

/**
 * Construit le transport live d'un provider donné.
 * Toute clé absente est refusée ici : jamais d'appel réseau sans credential.
 */
function createLiveTransport(
  config: LlmProviderConfig,
  options: { streaming: boolean; fetchImpl?: typeof fetch },
): LlmTransport {
  if (!config.apiKey) {
    throw new LlmError("LLM_LIVE_MISCONFIGURED", {
      message: `llm_live_api_key_missing:${config.provider}`,
    });
  }
  if (config.provider === "anthropic") {
    return createAnthropicMessagesTransport({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      anthropicVersion: config.anthropicVersion,
      stream: options.streaming,
      fetchImpl: options.fetchImpl,
    });
  }
  return createOpenAiCompatibleTransport({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    fetchImpl: options.fetchImpl,
  });
}

/**
 * Construit le runtime selon SIDIAN_LLM_*.
 *
 * - disabled → runtime qui refuse tout appel (aucun réseau)
 * - stub → transport déterministe local
 * - live → OpenAI-compatible ; API key absente → throw à la construction
 */
export function createLlmRuntimeFromEnv(
  options: CreateLlmRuntimeFromEnvOptions = {},
): LlmRuntime {
  const env = options.env ?? loadLlmEnv();
  const observability =
    options.observability ?? new NullLlmObservabilitySink();
  const budget = createLlmBudgetTracker({
    maxRequestsPerMinute: env.budgetMaxRequestsPerMinute,
    maxTokensPerMinute: env.budgetMaxTokensPerMinute,
    maxRequestsPerScopePerHour: env.budgetMaxRequestsPerScopePerHour,
  });

  if (options.transport) {
    return createLlmRuntime({
      transport: options.transport,
      mode: env.mode === "disabled" ? "stub" : env.mode,
      maxRetries: env.maxRetries,
      httpTimeoutMs: env.httpTimeoutMs,
      maxOutputTokens: env.maxOutputTokens,
      budget,
      observability,
    });
  }

  if (!env.enabled || env.mode === "disabled") {
    // Runtime présent mais fail-closed sur complete() — zéro réseau.
    const transport = createStubLlmTransport();
    return createLlmRuntime({
      transport,
      mode: "disabled",
      maxRetries: 0,
      httpTimeoutMs: env.httpTimeoutMs,
      maxOutputTokens: env.maxOutputTokens,
      budget,
      observability,
    });
  }

  if (env.mode === "stub") {
    return createLlmRuntime({
      transport: createStubLlmTransport(),
      mode: "stub",
      maxRetries: env.maxRetries,
      httpTimeoutMs: env.httpTimeoutMs,
      maxOutputTokens: env.maxOutputTokens,
      budget,
      observability,
    });
  }

  // live
  if (!env.apiKey) {
    throw new LlmError("LLM_LIVE_MISCONFIGURED", {
      message: "llm_live_api_key_missing",
    });
  }

  const liveOptions = {
    streaming: env.streaming,
    fetchImpl: options.fetchImpl,
  };
  const primary = createLiveTransport(env.providers[env.provider], liveOptions);
  const fallback = env.fallbackProvider
    ? createLiveTransport(env.providers[env.fallbackProvider], liveOptions)
    : undefined;

  return createLlmRuntime({
    transport: createFailoverLlmTransport({
      primary,
      fallback,
      onProviderServed: options.onProviderServed,
    }),
    mode: "live",
    maxRetries: env.maxRetries,
    httpTimeoutMs: env.httpTimeoutMs,
    maxOutputTokens: env.maxOutputTokens,
    budget,
    observability,
  });
}

export {
  InMemoryLlmObservabilitySink,
  NullLlmObservabilitySink,
};
