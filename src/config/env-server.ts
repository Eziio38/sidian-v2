import "server-only";

import { z } from "zod";

import { formatEnvValidationError } from "./env-shared";
import { getSupabasePublicEnv, type SupabasePublicEnv } from "./env-public";

const supabaseServerEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

const stripeServerEnvSchema = z.object({
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_CONNECT_WEBHOOK_SECRET: z.string().min(1),
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

export function getStripeServerEnv() {
  const parsed = stripeServerEnvSchema.safeParse({
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_CONNECT_WEBHOOK_SECRET: process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
  });

  if (!parsed.success) {
    const message = formatEnvValidationError("server/stripe", parsed.error);

    if (process.env.NODE_ENV === "development") {
      throw new Error(message);
    }

    throw new Error("Configuration Stripe manquante ou invalide.");
  }

  return parsed.data;
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
