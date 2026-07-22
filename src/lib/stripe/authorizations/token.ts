import "server-only";

import { createHash, createHmac } from "node:crypto";

import { getPaymentAuthorizationTokenSecret } from "@/config/env-server";

export const AUTHORIZATION_RAW_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Token stable pour une tentative donnée, mais imprévisible sans le secret
 * serveur dédié. La stabilité est nécessaire pour que le retry d'une création
 * Stripe avec la même idempotency key conserve exactement la même success_url.
 *
 * Ne dérive jamais de SUPABASE_SERVICE_ROLE_KEY : la rotation du secret
 * d'autorisation est indépendante de la clé service_role.
 */
export function authorizationTokenForTentative(
  tentativeId: string,
  secret = getPaymentAuthorizationTokenSecret(),
): string {
  return createHmac("sha256", secret)
    .update(`sidian:payment-authorization:${tentativeId}`, "utf8")
    .digest("base64url");
}

export function authorizationTokenHash(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function authorizationTokenForReconsideration(
  rawPaymentLinkToken: string,
  refusedAuthorizationId: string,
  secret = getPaymentAuthorizationTokenSecret(),
): string {
  return createHmac("sha256", secret)
    .update(
      `sidian:payment-authorization:reconsider:${rawPaymentLinkToken}:${refusedAuthorizationId}`,
      "utf8",
    )
    .digest("base64url");
}
