import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { evaluatePersistentRateLimits, type RateLimitDisposition } from "@/lib/security/rate-limit";
import { clientIpFromHeaders } from "@/lib/stripe/checkout/client-ip";
import type { Database } from "@/types/database.generated";

/**
 * Le webhook est borné par l'IP injectée par Vercel. Hors proxy de confiance,
 * toutes les origines partagent volontairement le même sujet déterministe.
 */
export function evaluateStripeWebhookRateLimit(params: {
  requestHeaders: Headers;
  supabaseAdmin: SupabaseClient<Database>;
}): Promise<RateLimitDisposition> {
  const clientIp = clientIpFromHeaders(params.requestHeaders);

  return evaluatePersistentRateLimits({
    supabaseAdmin: params.supabaseAdmin,
    subjects: [{ category: "stripe_webhook_ip", value: `ip:${clientIp}` }],
  });
}
