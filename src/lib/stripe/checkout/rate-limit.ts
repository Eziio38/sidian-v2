import "server-only";

import { createHmac } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseServerEnv } from "@/config/env-server";
import { StripeDomainError } from "@/lib/stripe/shared/errors";
import type { Database } from "@/types/database.generated";

export type PublicRateLimitCategory =
  Database["public"]["Enums"]["public_rate_limit_category"];

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  reset_at: string | null;
};

/**
 * Pseudonyme serveur stable et non réversible d'un sujet de quota (IP, token,
 * identifiant de lien). Aucune donnée brute n'est jamais transmise à la base :
 * le rate limiting ne stocke que cette empreinte (SHA-256 HMAC, 64 hex).
 */
export function pseudonymizeRateLimitSubject(
  category: PublicRateLimitCategory,
  value: string,
): string {
  const key = getSupabaseServerEnv().SUPABASE_SERVICE_ROLE_KEY;
  return createHmac("sha256", key)
    .update(`${category}:${value}`, "utf8")
    .digest("hex");
}

export async function consumePublicRateLimit(params: {
  supabaseAdmin: SupabaseClient<Database>;
  category: PublicRateLimitCategory;
  subjectHash: string;
}): Promise<RateLimitDecision> {
  const { data, error } = await params.supabaseAdmin.rpc(
    "consume_public_rate_limit",
    { p_category: params.category, p_subject_hash: params.subjectHash },
  );
  if (error || !data) {
    throw new StripeDomainError("rate_limit_unavailable", undefined, "retryable");
  }
  return data as RateLimitDecision;
}
