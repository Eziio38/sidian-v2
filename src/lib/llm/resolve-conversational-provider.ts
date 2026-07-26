/**
 * Résout le LlmProvider G1-N pour le point d’entrée HTTP agent.
 *
 * - disabled / stub → extracteur déterministe (aucun réseau)
 * - live → OpenAI-compatible via runtime ; config absente → throw (fail-closed)
 */

import "server-only";

import type { LlmProvider } from "@/lib/agent/conversational-runtime";

import { createConversationalExtractProvider } from "./adapters/conversational-extract";
import { loadLlmEnv, type LlmEnv } from "./env";
import { createLlmRuntimeFromEnv } from "./factory";
import type { LlmObservabilitySink } from "./types";

export type ResolveConversationalLlmProviderOptions = {
  env?: LlmEnv;
  observability?: LlmObservabilitySink;
  fetchImpl?: typeof fetch;
  budget_scope_key?: string;
};

export function resolveConversationalLlmProvider(
  options: ResolveConversationalLlmProviderOptions = {},
): LlmProvider {
  const env = options.env ?? loadLlmEnv();
  const runtime = createLlmRuntimeFromEnv({
    env,
    observability: options.observability,
    fetchImpl: options.fetchImpl,
  });

  return createConversationalExtractProvider({
    runtime,
    preferDeterministicStub:
      !env.enabled || env.mode === "disabled" || env.mode === "stub",
    budget_scope_key: options.budget_scope_key,
  });
}
