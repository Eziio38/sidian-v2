import "server-only";

import { z } from "zod";

export const WHATSAPP_TRANSPORT_MODES = ["disabled", "stub", "live"] as const;
export type WhatsAppTransportMode = (typeof WHATSAPP_TRANSPORT_MODES)[number];

const whatsappEnvSchema = z.object({
  SIDIAN_WHATSAPP_PROVIDER_ENABLED: z
    .enum(["true", "false"])
    .default("false"),
  SIDIAN_WHATSAPP_TRANSPORT_MODE: z
    .enum(WHATSAPP_TRANSPORT_MODES)
    .optional(),
  SIDIAN_WHATSAPP_ACCESS_TOKEN: z.string().min(1).optional(),
  SIDIAN_WHATSAPP_PHONE_NUMBER_ID: z.string().min(1).optional(),
  SIDIAN_WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().min(1).optional(),
  SIDIAN_WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().min(8).optional(),
  SIDIAN_WHATSAPP_APP_SECRET: z.string().min(16).optional(),
  SIDIAN_WHATSAPP_GRAPH_API_VERSION: z
    .string()
    .regex(/^v\d+(\.\d+)?$/)
    .default("v21.0"),
  SIDIAN_WHATSAPP_SIDIAN_SENDER_E164: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/)
    .optional(),
  /** Destinataire technique Guide (wa_id / test id) — hors API métier. */
  SIDIAN_WHATSAPP_GUIDE_RECIPIENT_TECHNICAL_ID: z.string().min(1).optional(),
  SIDIAN_WHATSAPP_HTTP_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(500)
    .max(30_000)
    .default(8_000),
});

export type WhatsAppEnv = {
  enabled: boolean;
  mode: WhatsAppTransportMode;
  accessToken?: string;
  phoneNumberId?: string;
  businessAccountId?: string;
  webhookVerifyToken?: string;
  appSecret?: string;
  graphApiVersion: string;
  senderE164?: string;
  guideRecipientTechnicalId?: string;
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
  explicit: WhatsAppTransportMode | undefined,
): WhatsAppTransportMode {
  if (!enabled) return "disabled";
  // Mode explicite obligatoire — pas de repli silencieux vers stub (HMAC off).
  if (!explicit) {
    throw new Error(
      "Configuration WhatsApp invalide : TRANSPORT_MODE requis si provider activé.",
    );
  }
  return explicit;
}

/**
 * Charge et valide la config WhatsApp.
 * Les secrets ne sont jamais sérialisés dans les messages d'erreur.
 */
export function loadWhatsAppEnv(
  input: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): WhatsAppEnv {
  const parsed = whatsappEnvSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Configuration WhatsApp manquante ou invalide.");
  }

  const enabled = parsed.data.SIDIAN_WHATSAPP_PROVIDER_ENABLED === "true";
  const mode = resolveMode(enabled, parsed.data.SIDIAN_WHATSAPP_TRANSPORT_MODE);
  const deployment = resolveDeploymentEnvironment(input);

  // Stub = unsigned webhooks autorisés uniquement en local.
  if (mode === "stub" && deployment !== "local") {
    throw new Error(
      "Configuration WhatsApp invalide : stub interdit hors environnement local.",
    );
  }

  if (mode === "live") {
    const missing: string[] = [];
    if (!parsed.data.SIDIAN_WHATSAPP_ACCESS_TOKEN) missing.push("ACCESS_TOKEN");
    if (!parsed.data.SIDIAN_WHATSAPP_PHONE_NUMBER_ID) {
      missing.push("PHONE_NUMBER_ID");
    }
    if (!parsed.data.SIDIAN_WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
      missing.push("WEBHOOK_VERIFY_TOKEN");
    }
    if (!parsed.data.SIDIAN_WHATSAPP_APP_SECRET) missing.push("APP_SECRET");
    if (!parsed.data.SIDIAN_WHATSAPP_SIDIAN_SENDER_E164) {
      missing.push("SIDIAN_SENDER_E164");
    }
    if (missing.length > 0) {
      throw new Error(
        `Configuration WhatsApp live incomplète (${missing.length} champ(s)).`,
      );
    }
  }

  return {
    enabled,
    mode,
    accessToken: parsed.data.SIDIAN_WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: parsed.data.SIDIAN_WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId: parsed.data.SIDIAN_WHATSAPP_BUSINESS_ACCOUNT_ID,
    webhookVerifyToken: parsed.data.SIDIAN_WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    appSecret: parsed.data.SIDIAN_WHATSAPP_APP_SECRET,
    graphApiVersion: parsed.data.SIDIAN_WHATSAPP_GRAPH_API_VERSION,
    senderE164: parsed.data.SIDIAN_WHATSAPP_SIDIAN_SENDER_E164,
    guideRecipientTechnicalId:
      parsed.data.SIDIAN_WHATSAPP_GUIDE_RECIPIENT_TECHNICAL_ID,
    httpTimeoutMs: parsed.data.SIDIAN_WHATSAPP_HTTP_TIMEOUT_MS,
  };
}

export function isWhatsAppProviderEnabled(
  env: WhatsAppEnv = loadWhatsAppEnv(),
): boolean {
  return env.enabled && env.mode !== "disabled";
}
