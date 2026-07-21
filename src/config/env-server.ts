import "server-only";

import { z } from "zod";

import { formatEnvValidationError } from "./env-shared";
import { getSupabasePublicEnv, type SupabasePublicEnv } from "./env-public";

const supabaseServerEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

const supabaseEnvironmentAttestationSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_ENVIRONMENT_ATTESTATION_JWT: z.string().min(1),
  SIDIAN_ENVIRONMENT: z.enum(["local", "staging", "production"]),
  SIDIAN_SUPABASE_PROJECT_REF: z.string().regex(/^[a-z0-9]{8,64}$/),
});

const stripeEnabledEnvSchema = z.object({
  NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED: z.literal("true"),
  SIDIAN_ENVIRONMENT: z.enum(["local", "staging", "production"]),
  STRIPE_MODE: z.enum(["test", "live"]),
  STRIPE_SECRET_KEY: z.string().regex(/^sk_(test|live)_\S+$/),
  STRIPE_CONNECT_WEBHOOK_SECRET: z.string().regex(/^whsec_\S+$/),
  SUPABASE_STRIPE_BINDING_WRITER_JWT: z.string().min(1),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z
    .string()
    .regex(/^pk_(test|live)_\S+$/),
});

const stripeDisabledEnvSchema = z.object({
  NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED: z.literal("false"),
});

const aiServerEnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
});

const emailServerEnvSchema = z.object({
  EMAIL_PROVIDER_API_KEY: z.string().min(1),
  EMAIL_FROM_ADDRESS: z.email(),
});

export type SupabaseServerEnv = SupabasePublicEnv & {
  SUPABASE_SERVICE_ROLE_KEY: string;
};

export type SidianEnvironment = "local" | "staging" | "production";
export type SupabaseEnvironmentAttestationEnv = z.infer<
  typeof supabaseEnvironmentAttestationSchema
>;
type StripeEnabledEnv = z.infer<typeof stripeEnabledEnvSchema>;
export type StripeServerEnv = Omit<
  StripeEnabledEnv,
  "SUPABASE_STRIPE_BINDING_WRITER_JWT"
>;
export type StripeBindingWriterEnv = Pick<
  SupabasePublicEnv,
  "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY"
> & {
  SUPABASE_STRIPE_BINDING_WRITER_JWT: string;
};
export type StripeReadiness =
  | { enabled: false }
  | ({ enabled: true } & StripeEnabledEnv);

export function validateStripeEnvironment(
  input: unknown,
  appEnvironment: SidianEnvironment,
): StripeReadiness {
  const disabled = stripeDisabledEnvSchema.safeParse(input);
  if (disabled.success) return { enabled: false };

  const parsed = stripeEnabledEnvSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Configuration Stripe manquante ou invalide.");
  }
  let writerClaims: { role?: unknown; sidian_environment?: unknown; exp?: unknown };
  try {
    const payload = parsed.data.SUPABASE_STRIPE_BINDING_WRITER_JWT.split(".")[1];
    if (!payload) throw new Error("missing_payload");
    writerClaims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as typeof writerClaims;
  } catch {
    throw new Error("Configuration Stripe manquante ou invalide.");
  }
  if (
    writerClaims.role !== "stripe_customer_binding_writer" ||
    writerClaims.sidian_environment !== parsed.data.SIDIAN_ENVIRONMENT ||
    typeof writerClaims.exp !== "number" ||
    writerClaims.exp <= Math.floor(Date.now() / 1000)
  ) {
    throw new Error("Configuration Stripe manquante ou invalide.");
  }
  const secretMode = parsed.data.STRIPE_SECRET_KEY.startsWith("sk_live_")
    ? "live"
    : "test";
  const publishableMode = parsed.data.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.startsWith(
    "pk_live_",
  )
    ? "live"
    : "test";
  if (
    secretMode !== parsed.data.STRIPE_MODE ||
    publishableMode !== parsed.data.STRIPE_MODE ||
    parsed.data.SIDIAN_ENVIRONMENT !== appEnvironment ||
    (appEnvironment === "production" && parsed.data.STRIPE_MODE !== "live") ||
    (appEnvironment !== "production" && parsed.data.STRIPE_MODE !== "test")
  ) {
    throw new Error("Configuration Stripe incohérente avec l’environnement.");
  }
  return { enabled: true, ...parsed.data };
}

function readSupabaseServerEnvInput() {
  return {
    ...getSupabasePublicEnv(),
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

export function isSupabaseServerEnvConfigured(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function getSupabaseServerEnv(): SupabaseServerEnv {
  const parsed = supabaseServerEnvSchema
    .extend({
      NEXT_PUBLIC_SUPABASE_URL: z.url(),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
    })
    .safeParse(readSupabaseServerEnvInput());

  if (!parsed.success) {
    const message = formatEnvValidationError("server/supabase", parsed.error);

    if (process.env.NODE_ENV === "development") {
      throw new Error(message);
    }

    throw new Error(
      "Configuration Supabase serveur manquante ou invalide.",
    );
  }

  return parsed.data;
}

export function validateSupabaseEnvironmentAttestation(
  input: unknown,
  expectedEnvironment: SidianEnvironment,
): SupabaseEnvironmentAttestationEnv {
  const parsed = supabaseEnvironmentAttestationSchema.safeParse(input);
  if (!parsed.success || parsed.data.SIDIAN_ENVIRONMENT !== expectedEnvironment) {
    throw new Error("Attestation Supabase manquante ou invalide.");
  }

  try {
    const supabaseUrl = new URL(parsed.data.NEXT_PUBLIC_SUPABASE_URL);
    if (
      supabaseUrl.protocol !== "https:" ||
      ![
        `${parsed.data.SIDIAN_SUPABASE_PROJECT_REF}.supabase.co`,
        `${parsed.data.SIDIAN_SUPABASE_PROJECT_REF}.supabase.in`,
      ].includes(supabaseUrl.hostname) ||
      supabaseUrl.pathname !== "/" ||
      supabaseUrl.search ||
      supabaseUrl.hash ||
      supabaseUrl.username ||
      supabaseUrl.password ||
      supabaseUrl.port
    ) {
      throw new Error("supabase_project_mismatch");
    }
  } catch {
    throw new Error("Attestation Supabase manquante ou invalide.");
  }

  let claims: {
    role?: unknown;
    sidian_environment?: unknown;
    sidian_project_ref?: unknown;
    exp?: unknown;
  };
  try {
    const payload = parsed.data.SUPABASE_ENVIRONMENT_ATTESTATION_JWT.split(".")[1];
    if (!payload) throw new Error("missing_payload");
    claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as typeof claims;
  } catch {
    throw new Error("Attestation Supabase manquante ou invalide.");
  }

  if (
    claims.role !== "sidian_environment_attestor" ||
    claims.sidian_environment !== expectedEnvironment ||
    claims.sidian_project_ref !== parsed.data.SIDIAN_SUPABASE_PROJECT_REF ||
    typeof claims.exp !== "number" ||
    claims.exp <= Math.floor(Date.now() / 1000)
  ) {
    throw new Error("Attestation Supabase manquante ou invalide.");
  }

  return parsed.data;
}

export function getSupabaseEnvironmentAttestationEnv(): SupabaseEnvironmentAttestationEnv {
  return validateSupabaseEnvironmentAttestation(
    {
      ...readSupabaseServerEnvInput(),
      SUPABASE_ENVIRONMENT_ATTESTATION_JWT:
        process.env.SUPABASE_ENVIRONMENT_ATTESTATION_JWT,
      SIDIAN_ENVIRONMENT: process.env.SIDIAN_ENVIRONMENT,
      SIDIAN_SUPABASE_PROJECT_REF: process.env.SIDIAN_SUPABASE_PROJECT_REF,
    },
    getApplicationEnvironment(),
  );
}

export function getApplicationEnvironment(): SidianEnvironment {
  if (process.env.VERCEL_ENV === "production") return "production";
  if (process.env.VERCEL_ENV === "preview") return "staging";
  return "local";
}

export function getStripeReadiness(): StripeReadiness {
  const input = {
    NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED:
      process.env.NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED,
    SIDIAN_ENVIRONMENT: process.env.SIDIAN_ENVIRONMENT,
    STRIPE_MODE: process.env.STRIPE_MODE,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_CONNECT_WEBHOOK_SECRET: process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
    SUPABASE_STRIPE_BINDING_WRITER_JWT:
      process.env.SUPABASE_STRIPE_BINDING_WRITER_JWT,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  };

  return validateStripeEnvironment(input, getApplicationEnvironment());
}

export function getStripeServerEnv(): StripeServerEnv {
  const readiness = getStripeReadiness();
  if (!readiness.enabled) {
    throw new Error("Module de paiement Stripe désactivé.");
  }
  return {
    NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED:
      readiness.NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED,
    SIDIAN_ENVIRONMENT: readiness.SIDIAN_ENVIRONMENT,
    STRIPE_MODE: readiness.STRIPE_MODE,
    STRIPE_SECRET_KEY: readiness.STRIPE_SECRET_KEY,
    STRIPE_CONNECT_WEBHOOK_SECRET: readiness.STRIPE_CONNECT_WEBHOOK_SECRET,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
      readiness.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  };
}

export function getStripeBindingWriterEnv(): StripeBindingWriterEnv {
  const stripe = getStripeReadiness();
  if (!stripe.enabled) {
    throw new Error("Module de paiement Stripe désactivé.");
  }
  const supabase = getSupabasePublicEnv();
  return {
    NEXT_PUBLIC_SUPABASE_URL: supabase.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: supabase.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_STRIPE_BINDING_WRITER_JWT:
      stripe.SUPABASE_STRIPE_BINDING_WRITER_JWT,
  };
}

export function isStripePaymentsEnabled(): boolean {
  return getStripeReadiness().enabled;
}

export function getSidianEnvironment(): SidianEnvironment {
  return getStripeServerEnv().SIDIAN_ENVIRONMENT;
}

export function getAiServerEnv() {
  const parsed = aiServerEnvSchema.safeParse({
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  });

  if (!parsed.success) {
    const message = formatEnvValidationError("server/ai", parsed.error);

    if (process.env.NODE_ENV === "development") {
      throw new Error(message);
    }

    throw new Error("Configuration IA manquante ou invalide.");
  }

  return parsed.data;
}

export function getEmailServerEnv() {
  const parsed = emailServerEnvSchema.safeParse({
    EMAIL_PROVIDER_API_KEY: process.env.EMAIL_PROVIDER_API_KEY,
    EMAIL_FROM_ADDRESS: process.env.EMAIL_FROM_ADDRESS,
  });

  if (!parsed.success) {
    const message = formatEnvValidationError("server/email", parsed.error);

    if (process.env.NODE_ENV === "development") {
      throw new Error(message);
    }

    throw new Error("Configuration email manquante ou invalide.");
  }

  return parsed.data;
}
