import "server-only";

import { createHmac } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseServerEnv } from "@/config/env-server";
import type { Database } from "@/types/database.generated";

export const PERSISTENT_RATE_LIMIT_CATEGORIES = [
  "link_resolution_ip",
  "link_resolution_token",
  "checkout_creation_ip",
  "checkout_new_operation_link",
  "auth_signup_ip",
  "auth_signup_email",
  "auth_signin_ip",
  "auth_signin_email",
  "auth_password_reset_ip",
  "auth_password_reset_email",
  "auth_password_update_ip",
  "auth_password_update_user",
  "auth_callback_ip",
  "auth_callback_code",
  "stripe_webhook_ip",
] as const;

export type PersistentRateLimitCategory =
  (typeof PERSISTENT_RATE_LIMIT_CATEGORIES)[number];

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  reset_at: string | null;
};

export type RateLimitDisposition =
  | { status: "allowed" }
  | { status: "limited"; resetAt: string | null }
  | { status: "unavailable" };

export class RateLimitUnavailableError extends Error {
  constructor() {
    super("rate_limit_unavailable");
    this.name = "RateLimitUnavailableError";
  }
}

function isRateLimitDecision(value: unknown): value is RateLimitDecision {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<RateLimitDecision>;
  return (
    typeof candidate.allowed === "boolean" &&
    Number.isInteger(candidate.remaining) &&
    (typeof candidate.reset_at === "string" || candidate.reset_at === null)
  );
}

/**
 * Produit un pseudonyme stable, cloisonné par catégorie et non réversible.
 * La valeur brute ne doit jamais être envoyée à Supabase ni à un logger.
 */
export function pseudonymizeRateLimitSubject(
  category: PersistentRateLimitCategory,
  value: string,
): string {
  const key = getSupabaseServerEnv().SUPABASE_SERVICE_ROLE_KEY;
  return createHmac("sha256", key)
    .update(`${category}:${value}`, "utf8")
    .digest("hex");
}

export async function consumePersistentRateLimit(params: {
  supabaseAdmin: SupabaseClient<Database>;
  category: PersistentRateLimitCategory;
  subjectHash: string;
}): Promise<RateLimitDecision> {
  // Les types générés seront régénérés après application des migrations. Ce
  // cast local garde le code compilable sans modifier le fichier généré sale.
  const databaseCategory = params.category as Database["public"]["Enums"]["public_rate_limit_category"];
  const { data, error } = await params.supabaseAdmin.rpc(
    "consume_public_rate_limit",
    { p_category: databaseCategory, p_subject_hash: params.subjectHash },
  );

  if (error || !isRateLimitDecision(data)) {
    throw new RateLimitUnavailableError();
  }

  return data;
}

export async function evaluatePersistentRateLimits(params: {
  supabaseAdmin: SupabaseClient<Database>;
  subjects: ReadonlyArray<{
    category: PersistentRateLimitCategory;
    value: string;
  }>;
}): Promise<RateLimitDisposition> {
  try {
    const decisions = await Promise.all(
      params.subjects.map(({ category, value }) =>
        consumePersistentRateLimit({
          supabaseAdmin: params.supabaseAdmin,
          category,
          subjectHash: pseudonymizeRateLimitSubject(category, value),
        }),
      ),
    );
    const denied = decisions.find((decision) => !decision.allowed);

    return denied
      ? { status: "limited", resetAt: denied.reset_at }
      : { status: "allowed" };
  } catch {
    return { status: "unavailable" };
  }
}
