import { createHmac } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@/types/database.generated";

const mocks = vi.hoisted(() => ({
  serviceRoleKey: "service-role-secret-for-tests",
}));

vi.mock("@/config/env-server", () => ({
  getSupabaseServerEnv: vi.fn(() => ({
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SERVICE_ROLE_KEY: mocks.serviceRoleKey,
  })),
}));

import {
  consumePersistentRateLimit,
  evaluatePersistentRateLimits,
  pseudonymizeRateLimitSubject,
  RateLimitUnavailableError,
} from "@/lib/security/rate-limit";

function adminWithRpc(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as unknown as SupabaseClient<Database>;
}

describe("rate limiting persistant générique", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("produit un HMAC cloisonné par catégorie", () => {
    const raw = "camille@example.com";
    const signInHash = pseudonymizeRateLimitSubject(
      "auth_signin_email",
      raw,
    );
    const signUpHash = pseudonymizeRateLimitSubject(
      "auth_signup_email",
      raw,
    );

    expect(signInHash).toMatch(/^[0-9a-f]{64}$/);
    expect(signInHash).toBe(
      createHmac("sha256", mocks.serviceRoleKey)
        .update(`auth_signin_email:${raw}`, "utf8")
        .digest("hex"),
    );
    expect(signUpHash).not.toBe(signInHash);
    expect(signInHash).not.toContain(raw);
  });

  it("n'envoie à la RPC que les pseudonymes, jamais les sujets bruts", async () => {
    const rpc = vi.fn(
      async (name: string, args: { p_subject_hash: string }) => {
        void name;
        void args;
        return {
          data: { allowed: true, remaining: 4, reset_at: null },
          error: null,
        };
      },
    );

    const result = await evaluatePersistentRateLimits({
      supabaseAdmin: adminWithRpc(rpc),
      subjects: [
        { category: "auth_signup_ip", value: "ip:203.0.113.7" },
        {
          category: "auth_signup_email",
          value: "identity:camille@example.com",
        },
      ],
    });

    expect(result).toEqual({ status: "allowed" });
    expect(rpc).toHaveBeenCalledTimes(2);
    for (const [, args] of rpc.mock.calls) {
      expect(args.p_subject_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(args.p_subject_hash).not.toContain("203.0.113.7");
      expect(args.p_subject_hash).not.toContain("camille@example.com");
    }
  });

  it("échoue fermé si la RPC renvoie une forme inattendue", async () => {
    const rpc = vi.fn(async () => ({
      data: { allowed: true },
      error: null,
    }));

    await expect(
      consumePersistentRateLimit({
        supabaseAdmin: adminWithRpc(rpc),
        category: "auth_signin_ip",
        subjectHash: "a".repeat(64),
      }),
    ).rejects.toBeInstanceOf(RateLimitUnavailableError);
  });

  it("renvoie limited dès qu'un des sujets est épuisé", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: { allowed: true, remaining: 2, reset_at: null },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          allowed: false,
          remaining: 0,
          reset_at: "2026-07-21T20:10:00.000Z",
        },
        error: null,
      });

    const result = await evaluatePersistentRateLimits({
      supabaseAdmin: adminWithRpc(rpc),
      subjects: [
        { category: "auth_signin_ip", value: "ip:203.0.113.7" },
        {
          category: "auth_signin_email",
          value: "identity:camille@example.com",
        },
      ],
    });

    expect(result).toEqual({
      status: "limited",
      resetAt: "2026-07-21T20:10:00.000Z",
    });
  });
});
