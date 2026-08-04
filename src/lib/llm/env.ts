/**
 * Config typée SIDIAN_LLM_* — fail-closed en mode live incomplet.
 *
 * Convention : tout se déclare sous le préfixe SIDIAN_LLM_*, comme
 * SIDIAN_EMAIL_* et SIDIAN_WHATSAPP_*. Les variables per-provider sont donc
 * SIDIAN_LLM_OPENAI_* et SIDIAN_LLM_ANTHROPIC_*, et non OPENAI_API_KEY /
 * ANTHROPIC_API_KEY. Seule exception tolérée : ANTHROPIC_API_KEY est accepté
 * en repli (nom injecté par défaut par beaucoup d'hébergeurs), avec une
 * précédence explicite derrière SIDIAN_LLM_ANTHROPIC_API_KEY.
 */

import "server-only";

import { z } from "zod";

import {
  ANTHROPIC_DEFAULT_BASE_URL,
  ANTHROPIC_DEFAULT_MODEL,
  ANTHROPIC_DEFAULT_VERSION,
} from "./providers/anthropic-messages";
import {
  OPENAI_DEFAULT_BASE_URL,
  OPENAI_DEFAULT_MODEL,
} from "./providers/openai-compatible";

export const LLM_TRANSPORT_MODES = ["disabled", "stub", "live"] as const;
export type LlmEnvTransportMode = (typeof LLM_TRANSPORT_MODES)[number];

export const LLM_PROVIDER_IDS = ["openai", "anthropic"] as const;
export type LlmProviderId = (typeof LLM_PROVIDER_IDS)[number];

const llmEnvSchema = z.object({
  SIDIAN_LLM_PROVIDER_ENABLED: z.enum(["true", "false"]).default("false"),
  SIDIAN_LLM_TRANSPORT_MODE: z.enum(LLM_TRANSPORT_MODES).optional(),

  // Sélection de provider — défaut openai pour compatibilité ascendante :
  // un déploiement existant ne renseignant que SIDIAN_LLM_API_KEY /
  // SIDIAN_LLM_BASE_URL continue de fonctionner à l'identique.
  SIDIAN_LLM_PROVIDER: z.enum(LLM_PROVIDER_IDS).default("openai"),
  SIDIAN_LLM_FALLBACK_PROVIDER: z.enum(LLM_PROVIDER_IDS).optional(),

  // Variables génériques historiques (mono-provider).
  SIDIAN_LLM_API_KEY: z.string().min(1).optional(),
  SIDIAN_LLM_BASE_URL: z.string().url().default(OPENAI_DEFAULT_BASE_URL),
  SIDIAN_LLM_MODEL: z.string().min(1).max(128).default(OPENAI_DEFAULT_MODEL),

  // Surcharges per-provider.
  SIDIAN_LLM_OPENAI_API_KEY: z.string().min(1).optional(),
  SIDIAN_LLM_OPENAI_BASE_URL: z.string().url().optional(),
  SIDIAN_LLM_OPENAI_MODEL: z.string().min(1).max(128).optional(),
  SIDIAN_LLM_ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  SIDIAN_LLM_ANTHROPIC_BASE_URL: z
    .string()
    .url()
    .default(ANTHROPIC_DEFAULT_BASE_URL),
  SIDIAN_LLM_ANTHROPIC_MODEL: z
    .string()
    .min(1)
    .max(128)
    .default(ANTHROPIC_DEFAULT_MODEL),
  SIDIAN_LLM_ANTHROPIC_VERSION: z
    .string()
    .min(1)
    .max(32)
    .default(ANTHROPIC_DEFAULT_VERSION),

  /** Consommation SSE du provider (le résultat rendu reste agrégé). */
  SIDIAN_LLM_STREAMING_ENABLED: z.enum(["true", "false"]).default("false"),

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

export type LlmProviderConfig = {
  provider: LlmProviderId;
  apiKey?: string;
  baseUrl: string;
  model: string;
  /** Anthropic uniquement — en-tête `anthropic-version`. */
  anthropicVersion?: string;
};

export type LlmEnv = {
  enabled: boolean;
  mode: LlmEnvTransportMode;
  /** Provider primaire. */
  provider: LlmProviderId;
  /** Provider de secours — absent = aucune bascule. */
  fallbackProvider?: LlmProviderId;
  /** Config résolue par provider (indépendante de la sélection). */
  providers: Record<LlmProviderId, LlmProviderConfig>;
  streaming: boolean;
  /** Raccourcis du provider primaire — compatibilité ascendante. */
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

/**
 * Environnement de déploiement, résolu comme pour l'email et WhatsApp.
 * `SIDIAN_ENVIRONMENT` prime, `VERCEL_ENV` sert de repli.
 */
function resolveDeploymentEnvironment(
  input: NodeJS.ProcessEnv | Record<string, string | undefined>,
): "local" | "staging" | "production" {
  const explicit = input.SIDIAN_ENVIRONMENT;
  if (
    explicit === "local" ||
    explicit === "staging" ||
    explicit === "production"
  ) {
    return explicit;
  }
  if (input.VERCEL_ENV === "production") return "production";
  if (input.VERCEL_ENV === "preview") return "staging";
  return "local";
}

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

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function isProvided(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Copie où toute valeur vide devient absente. N'altère jamais process.env. */
function normalizeEmptyValues(
  input: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Record<string, string | undefined> {
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(input)) {
    normalized[key] = typeof value === "string" && value.trim() === ""
      ? undefined
      : value;
  }
  return normalized;
}

type ParsedLlmEnv = z.infer<typeof llmEnvSchema>;

/**
 * Résout la config de chaque provider.
 *
 * Les variables génériques (SIDIAN_LLM_API_KEY / _BASE_URL / _MODEL) ne
 * s'appliquent qu'au provider primaire : c'est ce qui garantit qu'un
 * déploiement mono-provider existant reste inchangé, sans jamais fournir par
 * accident une clé OpenAI au transport Anthropic.
 */
function resolveProviderConfigs(
  parsed: ParsedLlmEnv,
  raw: NodeJS.ProcessEnv | Record<string, string | undefined>,
  primary: LlmProviderId,
): Record<LlmProviderId, LlmProviderConfig> {
  const genericKey = parsed.SIDIAN_LLM_API_KEY;
  // `SIDIAN_LLM_MODEL` a un défaut OpenAI dans le schéma : seule sa présence
  // brute permet de savoir si l'opérateur l'a réellement renseigné.
  const genericModelProvided = isProvided(raw.SIDIAN_LLM_MODEL);
  const anthropicModelProvided = isProvided(raw.SIDIAN_LLM_ANTHROPIC_MODEL);

  const openai: LlmProviderConfig = {
    provider: "openai",
    apiKey:
      parsed.SIDIAN_LLM_OPENAI_API_KEY ??
      (primary === "openai" ? genericKey : undefined),
    baseUrl: stripTrailingSlash(
      parsed.SIDIAN_LLM_OPENAI_BASE_URL ?? parsed.SIDIAN_LLM_BASE_URL,
    ),
    model:
      parsed.SIDIAN_LLM_OPENAI_MODEL ??
      (primary === "openai" && genericModelProvided
        ? parsed.SIDIAN_LLM_MODEL
        : OPENAI_DEFAULT_MODEL),
  };

  const anthropic: LlmProviderConfig = {
    provider: "anthropic",
    apiKey:
      parsed.SIDIAN_LLM_ANTHROPIC_API_KEY ??
      parsed.ANTHROPIC_API_KEY ??
      (primary === "anthropic" ? genericKey : undefined),
    // Jamais SIDIAN_LLM_BASE_URL : son défaut pointe sur OpenAI.
    baseUrl: stripTrailingSlash(parsed.SIDIAN_LLM_ANTHROPIC_BASE_URL),
    model:
      !anthropicModelProvided && primary === "anthropic" && genericModelProvided
        ? parsed.SIDIAN_LLM_MODEL
        : parsed.SIDIAN_LLM_ANTHROPIC_MODEL,
    anthropicVersion: parsed.SIDIAN_LLM_ANTHROPIC_VERSION,
  };

  return { openai, anthropic };
}

/**
 * Charge et valide la config LLM.
 * Secrets jamais sérialisés dans les messages d’erreur.
 */
export function loadLlmEnv(
  rawInput: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): LlmEnv {
  // `.env.example` déclare les variables optionnelles vides (`VAR=`), ce qui
  // produit une chaîne vide et non `undefined` : sans cette normalisation, un
  // provider laissé vide ferait échouer tout le chargement, y compris quand
  // le runtime LLM est désactivé.
  const input = normalizeEmptyValues(rawInput);
  const parsed = llmEnvSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Configuration LLM manquante ou invalide.");
  }

  const enabled = parsed.data.SIDIAN_LLM_PROVIDER_ENABLED === "true";
  const mode = resolveMode(enabled, parsed.data.SIDIAN_LLM_TRANSPORT_MODE);
  const deployment = resolveDeploymentEnvironment(input);

  // Même invariant que l'email et WhatsApp : le stub renvoie des réponses
  // déterministes locales sans jamais appeler de modèle. Hors environnement
  // local, ce serait présenter une capacité indisponible comme opérationnelle.
  if (mode === "stub" && deployment !== "local") {
    throw new Error(
      "Configuration LLM invalide : stub interdit hors environnement local.",
    );
  }

  // Production : soit explicitement live, soit franchement désactivé.
  if (deployment === "production" && enabled && mode !== "live") {
    throw new Error(
      "Configuration LLM invalide : mode live requis en production si le provider est activé.",
    );
  }

  const provider = parsed.data.SIDIAN_LLM_PROVIDER;
  const fallbackProvider = parsed.data.SIDIAN_LLM_FALLBACK_PROVIDER;

  if (fallbackProvider && fallbackProvider === provider) {
    throw new Error(
      "Configuration LLM invalide : le provider de secours doit différer du provider principal.",
    );
  }

  const providers = resolveProviderConfigs(parsed.data, input, provider);

  if (mode === "live") {
    // Fail-closed à la construction, pas à la première requête.
    if (!providers[provider].apiKey) {
      throw new Error("Configuration LLM live incomplète (API_KEY manquante).");
    }
    if (fallbackProvider && !providers[fallbackProvider].apiKey) {
      throw new Error(
        "Configuration LLM live incomplète (API_KEY du provider de secours manquante).",
      );
    }
  }

  return {
    enabled,
    mode,
    provider,
    fallbackProvider,
    providers,
    streaming: parsed.data.SIDIAN_LLM_STREAMING_ENABLED === "true",
    apiKey: providers[provider].apiKey,
    baseUrl: providers[provider].baseUrl,
    model: providers[provider].model,
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
