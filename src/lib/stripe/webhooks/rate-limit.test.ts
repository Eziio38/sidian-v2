import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  evaluatePersistentRateLimits: vi.fn(async () => ({
    status: "allowed" as const,
  })),
}));

vi.mock("@/lib/security/rate-limit", () => ({
  evaluatePersistentRateLimits: mocks.evaluatePersistentRateLimits,
}));

import { evaluateStripeWebhookRateLimit } from "@/lib/stripe/webhooks/rate-limit";

describe("rate limiting du webhook Stripe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VERCEL", "1");
  });

  it("consomme le quota webhook avec l'IP de plateforme uniquement", async () => {
    const supabaseAdmin = { kind: "admin" };

    await evaluateStripeWebhookRateLimit({
      requestHeaders: new Headers({
        "x-forwarded-for": "198.51.100.99",
        "x-vercel-forwarded-for": "203.0.113.9",
      }),
      supabaseAdmin: supabaseAdmin as never,
    });

    expect(mocks.evaluatePersistentRateLimits).toHaveBeenCalledWith({
      supabaseAdmin,
      subjects: [
        { category: "stripe_webhook_ip", value: "ip:203.0.113.9" },
      ],
    });
  });
});
