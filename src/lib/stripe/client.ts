import "server-only";

import Stripe from "stripe";

import { getStripeServerEnv } from "@/config/env-server";

/** Version API épinglée sur celle du SDK stripe installé (22.x → 2026-06-24.dahlia). */
export const SIDIAN_STRIPE_API_VERSION = "2026-06-24.dahlia" as const;

export type StripeMode = "test" | "live";

export function resolveStripeMode(secretKey: string): StripeMode {
  if (secretKey.startsWith("sk_live_")) {
    return "live";
  }
  if (secretKey.startsWith("sk_test_")) {
    return "test";
  }
  throw new Error("stripe_secret_key_mode_unknown");
}

let cached: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (cached) {
    return cached;
  }

  const env = getStripeServerEnv();
  resolveStripeMode(env.STRIPE_SECRET_KEY);

  cached = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: SIDIAN_STRIPE_API_VERSION,
    typescript: true,
    timeout: 15_000,
    maxNetworkRetries: 2,
    appInfo: {
      name: "Sidian",
      version: "0.1.0",
    },
  });

  return cached;
}

/** Client injectable pour tests (mocks). */
export function createStripeClient(
  secretKey: string,
  options?: Stripe.StripeConfig,
): Stripe {
  resolveStripeMode(secretKey);
  return new Stripe(secretKey, {
    apiVersion: SIDIAN_STRIPE_API_VERSION,
    typescript: true,
    timeout: 15_000,
    maxNetworkRetries: 2,
    ...options,
  });
}

export function getStripeWebhookSecret(): string {
  return getStripeServerEnv().STRIPE_CONNECT_WEBHOOK_SECRET;
}
