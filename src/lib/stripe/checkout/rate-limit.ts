import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  consumePersistentRateLimit,
  pseudonymizeRateLimitSubject,
  RateLimitUnavailableError,
  type RateLimitDecision,
} from "@/lib/security/rate-limit";
import { StripeDomainError } from "@/lib/stripe/shared/errors";
import type { Database } from "@/types/database.generated";

export type PublicRateLimitCategory =
  Database["public"]["Enums"]["public_rate_limit_category"];

export { pseudonymizeRateLimitSubject };
export type { RateLimitDecision };

export async function consumePublicRateLimit(params: {
  supabaseAdmin: SupabaseClient<Database>;
  category: PublicRateLimitCategory;
  subjectHash: string;
}): Promise<RateLimitDecision> {
  try {
    return await consumePersistentRateLimit(params);
  } catch (error) {
    if (!(error instanceof RateLimitUnavailableError)) throw error;
    throw new StripeDomainError("rate_limit_unavailable", undefined, "retryable");
  }
}
