import "server-only";

import { z } from "zod";

export const EMAIL_TRANSPORT_MODES = ["disabled", "stub", "live"] as const;
export type EmailTransportMode = (typeof EMAIL_TRANSPORT_MODES)[number];

/**
 * Vendors d'envoi supportés. Chacun a son propre contrat HTTP : le choix est
 * explicite, jamais deviné depuis la forme de la clé.
 */
export const EMAIL_LIVE_PROVIDERS = ["brevo", "resend"] as const;
export type EmailLiveProvider = (typeof EMAIL_LIVE_PROVIDERS)[number];

const emailEnvSchema = z.object({
  SIDIAN_EMAIL_PROVIDER_ENABLED: z.enum(["true", "false"]).default("false"),
  SIDIAN_EMAIL_TRANSPORT_MODE: z.enum(EMAIL_TRANSPORT_MODES).optional(),
  SIDIAN_EMAIL_PROVIDER: z.enum(EMAIL_LIVE_PROVIDERS).default("brevo"),
  SIDIAN_EMAIL_API_KEY: z.string().min(1).optional(),
  SIDIAN_EMAIL_FROM_ADDRESS: z.string().email().optional(),
  SIDIAN_EMAIL_FROM_NAME: z.string().min(1).max(120).optional(),
  SIDIAN_EMAIL_REPLY_TO: z.string().email().optional(),
  SIDIAN_EMAIL_HTTP_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(500)
    .max(30_000)
    .default(8_000),
});

export type EmailEnv = {
  enabled: boolean;
  mode: EmailTransportMode;
  /** Vendor retenu en mode `live`. Sans effet en `stub` / `disabled`. */
  providerKind: EmailLiveProvider;
  apiKey?: string;
  fromAddress?: string;
  fromName?: string;
  replyTo?: string;
  httpTimeoutMs: number;
};

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
  explicit: EmailTransportMode | undefined,
): EmailTransportMode {
  if (!enabled) return "disabled";
  if (!explicit) {
    throw new Error(
      "Configuration email invalide : TRANSPORT_MODE requis si provider activé.",
    );
  }
  return explicit;
}

/**
 * Charge et valide la config email.
 * Fail-closed en production / live : secrets et from obligatoires.
 * Les secrets ne sont jamais sérialisés dans les messages d'erreur.
 */
export function loadEmailEnv(
  input: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): EmailEnv {
  const parsed = emailEnvSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Configuration email manquante ou invalide.");
  }

  const enabled = parsed.data.SIDIAN_EMAIL_PROVIDER_ENABLED === "true";
  const mode = resolveMode(enabled, parsed.data.SIDIAN_EMAIL_TRANSPORT_MODE);
  const deployment = resolveDeploymentEnvironment(input);

  if (mode === "stub" && deployment !== "local") {
    throw new Error(
      "Configuration email invalide : stub interdit hors environnement local.",
    );
  }

  // Production : provider doit être explicitement configuré (live) ou désactivé.
  if (deployment === "production" && enabled && mode !== "live") {
    throw new Error(
      "Configuration email invalide : production exige mode live ou provider désactivé.",
    );
  }

  if (mode === "live") {
    const missing: string[] = [];
    if (!parsed.data.SIDIAN_EMAIL_API_KEY) missing.push("API_KEY");
    if (!parsed.data.SIDIAN_EMAIL_FROM_ADDRESS) missing.push("FROM_ADDRESS");
    if (missing.length > 0) {
      throw new Error(
        `Configuration email live incomplète (${missing.length} champ(s)).`,
      );
    }
  }

  return {
    enabled,
    mode,
    providerKind: parsed.data.SIDIAN_EMAIL_PROVIDER,
    apiKey: parsed.data.SIDIAN_EMAIL_API_KEY,
    fromAddress: parsed.data.SIDIAN_EMAIL_FROM_ADDRESS,
    fromName: parsed.data.SIDIAN_EMAIL_FROM_NAME,
    replyTo: parsed.data.SIDIAN_EMAIL_REPLY_TO,
    httpTimeoutMs: parsed.data.SIDIAN_EMAIL_HTTP_TIMEOUT_MS,
  };
}

export function isEmailProviderEnabled(
  env: EmailEnv = loadEmailEnv(),
): boolean {
  return env.enabled && env.mode !== "disabled";
}
