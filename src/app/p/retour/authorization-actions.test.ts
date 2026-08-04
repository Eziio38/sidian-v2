import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(async () => ({ rpc: vi.fn() })),
  createSetup: vi.fn(async () => ({ status: "retry" as const })),
  decline: vi.fn(async () => "declined" as string),
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
  createAuthorizationSetupSession: mocks.createSetup,
  declineAuthorizationProposal: mocks.decline,
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

const { authorizationDecisionAction } = await import("./authorization-actions");

function decisionForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  form.set("authorization_token", overrides.authorization_token ?? "A".repeat(43));
  form.set("source_session_id", overrides.source_session_id ?? "cs_payment");
  form.set("decision", overrides.decision ?? "accept");
  form.set("consent", "accepted");
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authorizationDecisionAction validation publique", () => {
  it.each([
    ["token surdimensionné", { authorization_token: "A".repeat(1_000_000) }],
    ["session surdimensionnée", { source_session_id: `cs_${"A".repeat(300)}` }],
    ["session malformée", { source_session_id: "not-a-checkout-session" }],
    ["décision inconnue", { decision: "force" }],
  ])("%s → not_available avant toute dépendance serveur", async (_label, override) => {
    await expect(
      authorizationDecisionAction(null, decisionForm(override)),
    ).resolves.toEqual({ status: "not_available" });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.createSetup).not.toHaveBeenCalled();
    expect(mocks.decline).not.toHaveBeenCalled();
  });

  it("lit l'IP de confiance et restitue le quota de refus", async () => {
    mocks.decline.mockResolvedValueOnce("rate_limited");
    const form = decisionForm({ decision: "decline" });

    await expect(authorizationDecisionAction(null, form)).resolves.toEqual({
      status: "rate_limited",
    });
    expect(mocks.headers).toHaveBeenCalledOnce();
    expect(mocks.decline).toHaveBeenCalledWith(
      expect.objectContaining({ clientIp: "203.0.113.8" }),
    );
  });
});
