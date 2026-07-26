/**
 * Config typée SIDIAN_LLM_* — fail-closed en mode live incomplet.
 */

import "server-only";

import { z } from "zod";

export const LLM_TRANSPORT_MODES = ["disabled", "stub", "live"] as const;
export type LlmEnvTransportMode = (typeof LLM_TRANSPORT_MODES)[number];

const llmEnvSchema = z.object({
  SIDIAN_LLM_PROVIDER_ENABLED: z.enum(["true", "false"]).default("false"),
  SIDIAN_LLM_TRANSPORT_MODE: z.enum(LLM_TRANSPORT_MODES).optional(),
  SIDIAN_LLM_API_KEY: z.string().min(1).optional(),
  SIDIAN_LLM_BASE_URL: z
    .string()
    .url()
    .default("https://api.openai.com/v1"),
  SIDIAN_LLM_MODEL: z.string().min(1).max(128).default("gpt-4o-mini"),
  SIDIAN_LLM_HTTP_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(500)
    .max(60_000)
    .default(8_000),
  SIDIAN_LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(1),
  SIDIAN_LLM_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .min(64)
    .max(4_096)
    .default(1_024),
  SIDIAN_LLM_BUDGET_MAX_REQUESTS_PER_MINUTE: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000)
    .default(30),
  SIDIAN_LLM_BUDGET_MAX_TOKENS_PER_MINUTE: z.coerce
    .number()
    .int()
    .min(100)
    .max(2_000_000)
    .default(50_000),
  SIDIAN_LLM_BUDGET_MAX_REQUESTS_PER_SCOPE_PER_HOUR: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .default(200),
});

export type LlmEnv = {
  enabled: boolean;
  mode: LlmEnvTransportMode;
  apiKey?: string;
  baseUrl: string;
  model: string;
  httpTimeoutMs: number;
  maxRetries: number;
  maxOutputTokens: number;
  budgetMaxRequestsPerMinute: number;
  budgetMaxTokensPerMinute: number;
  budgetMaxRequestsPerScopePerHour: number;
};

function resolveMode(
  enabled: boolean,
  explicit: LlmEnvTransportMode | undefined,
): LlmEnvTransportMode {
  if (!enabled) return "disabled";
  if (!explicit) {
    throw new Error(
      "Configuration LLM invalide : TRANSPORT_MODE requis si provider activé.",
    );
  }
  return explicit;
}

/**
 * Charge et valide la config LLM.
 * Secrets jamais sérialisés dans les messages d’erreur.
 */
export function loadLlmEnv(
  input: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): LlmEnv {
  const parsed = llmEnvSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Configuration LLM manquante ou invalide.");
  }

  const enabled = parsed.data.SIDIAN_LLM_PROVIDER_ENABLED === "true";
  const mode = resolveMode(enabled, parsed.data.SIDIAN_LLM_TRANSPORT_MODE);

  if (mode === "live") {
    if (!parsed.data.SIDIAN_LLM_API_KEY) {
      throw new Error("Configuration LLM live incomplète (API_KEY manquante).");
    }
  }

  return {
    enabled,
    mode,
    apiKey: parsed.data.SIDIAN_LLM_API_KEY,
    baseUrl: parsed.data.SIDIAN_LLM_BASE_URL.replace(/\/$/, ""),
    model: parsed.data.SIDIAN_LLM_MODEL,
    httpTimeoutMs: parsed.data.SIDIAN_LLM_HTTP_TIMEOUT_MS,
    maxRetries: parsed.data.SIDIAN_LLM_MAX_RETRIES,
    maxOutputTokens: parsed.data.SIDIAN_LLM_MAX_OUTPUT_TOKENS,
    budgetMaxRequestsPerMinute:
      parsed.data.SIDIAN_LLM_BUDGET_MAX_REQUESTS_PER_MINUTE,
    budgetMaxTokensPerMinute:
      parsed.data.SIDIAN_LLM_BUDGET_MAX_TOKENS_PER_MINUTE,
    budgetMaxRequestsPerScopePerHour:
      parsed.data.SIDIAN_LLM_BUDGET_MAX_REQUESTS_PER_SCOPE_PER_HOUR,
  };
}

export function isLlmProviderEnabled(env: LlmEnv = loadLlmEnv()): boolean {
  return env.enabled && env.mode !== "disabled";
}
