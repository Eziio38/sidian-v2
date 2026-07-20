import { z } from "zod";

import { formatEnvValidationError } from "./env-shared";

const supabasePublicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

const publicEnvSchema = z
  .object({
    NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
    NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED: z.enum(["true", "false"]),
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    if (
      value.NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED === "true" &&
      !/^pk_(test|live)_\S+$/.test(value.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "")
    ) {
      context.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"],
        message: "Clé publiable Stripe requise lorsque le module est activé.",
      });
    }
  });

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type SupabasePublicEnv = z.infer<typeof supabasePublicEnvSchema>;

const SUPABASE_CLOUD_HOST_SUFFIXES = [".supabase.co", ".supabase.in"] as const;

export function normalizeSupabaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/$/, "");

  try {
    const parsed = new URL(trimmed);
    const isSupabaseCloud = SUPABASE_CLOUD_HOST_SUFFIXES.some((suffix) =>
      parsed.hostname.endsWith(suffix),
    );

    if (parsed.protocol === "http:" && isSupabaseCloud) {
      parsed.protocol = "https:";
      return parsed.toString().replace(/\/$/, "");
    }

    return trimmed;
  } catch {
    return trimmed;
  }
}

function readPublicEnvInput() {
  return {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED:
      process.env.NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  };
}

function readSupabasePublicEnvInput() {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

export function isSupabasePublicEnvConfigured(): boolean {
  const input = readSupabasePublicEnvInput();

  return Boolean(
    input.NEXT_PUBLIC_SUPABASE_URL && input.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export function getSupabasePublicEnv(): SupabasePublicEnv {
  const parsed = supabasePublicEnvSchema.safeParse(readSupabasePublicEnvInput());

  if (!parsed.success) {
    const message = formatEnvValidationError("public/supabase", parsed.error);

    if (process.env.NODE_ENV === "development") {
      throw new Error(message);
    }

    throw new Error(
      "Configuration Supabase publique manquante ou invalide.",
    );
  }

  return {
    ...parsed.data,
    NEXT_PUBLIC_SUPABASE_URL: normalizeSupabaseUrl(
      parsed.data.NEXT_PUBLIC_SUPABASE_URL,
    ),
  };
}

export function getPublicEnv(): PublicEnv {
  const parsed = publicEnvSchema.safeParse(readPublicEnvInput());

  if (!parsed.success) {
    const message = formatEnvValidationError("public", parsed.error);

    if (process.env.NODE_ENV === "development") {
      throw new Error(message);
    }

    throw new Error("Configuration publique manquante ou invalide.");
  }

  return {
    ...parsed.data,
    NEXT_PUBLIC_SUPABASE_URL: normalizeSupabaseUrl(
      parsed.data.NEXT_PUBLIC_SUPABASE_URL,
    ),
  };
}
