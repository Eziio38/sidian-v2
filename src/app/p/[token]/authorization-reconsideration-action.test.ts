import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(async () => ({ rpc: vi.fn() })),
  prepare: vi.fn(async () => ({ status: "not_available" as const })),
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("@/config/env-server", () => ({
  getSidianEnvironment: () => "local",
  isStripePaymentsEnabled: () => true,
}));
vi.mock("@/config/env-public", () => ({
  getPublicEnv: () => ({ NEXT_PUBLIC_APP_URL: "https://app.sidian.test" }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/stripe/authorizations/create-setup-session", () => ({
  prepareAuthorizationReconsideration: mocks.prepare,
}));
vi.mock("@/lib/stripe/checkout/client-ip", () => ({
  clientIpFromHeaders: () => "203.0.113.8",
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("redirect"), { digest: `NEXT_REDIRECT;${url}` });
  },
}));

const { authorizationReconsiderationAction } = await import(
  "./authorization-reconsideration-action"
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authorizationReconsiderationAction validation publique", () => {
  it.each(["court", "A".repeat(1_000_000)])(
    "token malformé ou surdimensionné → not_available sans RPC",
    async (token) => {
      const form = new FormData();
      form.set("payment_token", token);
      await expect(
        authorizationReconsiderationAction(null, form),
      ).resolves.toEqual({ status: "not_available" });
      expect(mocks.createAdminClient).not.toHaveBeenCalled();
      expect(mocks.prepare).not.toHaveBeenCalled();
      expect(mocks.headers).not.toHaveBeenCalled();
    },
  );
});
