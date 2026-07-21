import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  evaluatePersistentRateLimits: vi.fn(async () => ({
    status: "allowed" as const,
  })),
  createAdminClient: vi.fn(() => ({ kind: "admin" })),
  logServerEvent: vi.fn(),
}));

vi.mock("@/lib/security/rate-limit", () => ({
  evaluatePersistentRateLimits: mocks.evaluatePersistentRateLimits,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/observability/server-logger", () => ({
  logServerEvent: mocks.logServerEvent,
}));

import { evaluateAuthRateLimit } from "@/lib/auth/rate-limit";

describe("politique de rate limiting Auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VERCEL", "1");
    mocks.evaluatePersistentRateLimits.mockResolvedValue({ status: "allowed" });
  });

  it("utilise l'IP Vercel de confiance et ignore X-Forwarded-For", async () => {
    const result = await evaluateAuthRateLimit({
      operation: "sign_in",
      identity: "camille@example.com",
      requestHeaders: new Headers({
        "x-forwarded-for": "198.51.100.99",
        "x-vercel-forwarded-for": "203.0.113.7",
      }),
    });

    expect(result).toEqual({ status: "allowed" });
    expect(mocks.evaluatePersistentRateLimits).toHaveBeenCalledWith({
      supabaseAdmin: { kind: "admin" },
      subjects: [
        { category: "auth_signin_ip", value: "ip:203.0.113.7" },
        {
          category: "auth_signin_email",
          value: "identity:camille@example.com",
        },
      ],
    });
  });

  it("échoue fermé si le client privé ne peut pas être créé", async () => {
    mocks.createAdminClient.mockImplementationOnce(() => {
      throw new Error("configuration unavailable");
    });

    const requestId = "11111111-1111-4111-8111-111111111111";
    await expect(
      evaluateAuthRateLimit({
        operation: "sign_up",
        identity: "camille@example.com",
        requestHeaders: new Headers({
          "x-sidian-request-id": requestId,
        }),
      }),
    ).resolves.toEqual({ status: "unavailable" });
    expect(mocks.evaluatePersistentRateLimits).not.toHaveBeenCalled();
    expect(mocks.logServerEvent).toHaveBeenCalledWith(
      "warn",
      "security.rate_limit_unavailable",
      {
        requestId,
        operation: "sign_up",
        component: "auth",
        errorCode: "Error",
      },
    );
    expect(JSON.stringify(mocks.logServerEvent.mock.calls)).not.toContain(
      "camille@example.com",
    );
  });
});
