import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { evaluatePersistentRateLimits, type RateLimitDisposition } from "@/lib/security/rate-limit";
import { requestIdFromHeaders } from "@/lib/observability/request-id";
import { logServerEvent } from "@/lib/observability/server-logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIpFromHeaders } from "@/lib/stripe/checkout/client-ip";
import type { Database } from "@/types/database.generated";

export type AuthRateLimitOperation =
  | "sign_up"
  | "sign_in"
  | "password_reset"
  | "password_update"
  | "callback";

const AUTH_RATE_LIMIT_POLICY = {
  sign_up: {
    ip: "auth_signup_ip",
    identity: "auth_signup_email",
  },
  sign_in: {
    ip: "auth_signin_ip",
    identity: "auth_signin_email",
  },
  password_reset: {
    ip: "auth_password_reset_ip",
    identity: "auth_password_reset_email",
  },
  password_update: {
    ip: "auth_password_update_ip",
    identity: "auth_password_update_user",
  },
  callback: {
    ip: "auth_callback_ip",
    identity: "auth_callback_code",
  },
} as const;

/**
 * Évalue les deux défenses persistantes d'une opération Auth : origine réseau
 * normalisée par le proxy de confiance et identité logique déjà validée. Les
 * valeurs brutes restent en mémoire le temps de produire leur HMAC.
 */
export async function evaluateAuthRateLimit(params: {
  operation: AuthRateLimitOperation;
  requestHeaders: Headers;
  identity: string;
  supabaseAdmin?: SupabaseClient<Database>;
}): Promise<RateLimitDisposition> {
  try {
    const policy = AUTH_RATE_LIMIT_POLICY[params.operation];
    const supabaseAdmin = params.supabaseAdmin ?? (await createAdminClient());
    const clientIp = clientIpFromHeaders(params.requestHeaders);

    const disposition = await evaluatePersistentRateLimits({
      supabaseAdmin,
      subjects: [
        { category: policy.ip, value: `ip:${clientIp}` },
        { category: policy.identity, value: `identity:${params.identity}` },
      ],
    });

    if (disposition.status === "unavailable") {
      logServerEvent("warn", "security.rate_limit_unavailable", {
        requestId: requestIdFromHeaders(params.requestHeaders),
        operation: params.operation,
        component: "auth",
      });
    }

    return disposition;
  } catch (error) {
    logServerEvent("warn", "security.rate_limit_unavailable", {
      requestId: requestIdFromHeaders(params.requestHeaders),
      operation: params.operation,
      component: "auth",
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    return { status: "unavailable" };
  }
}
