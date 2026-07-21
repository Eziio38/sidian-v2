import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  evaluateAuthRateLimit: vi.fn(async () =>
    ({ status: "allowed" }) as
      | { status: "allowed" }
      | { status: "limited"; resetAt: string | null }
      | { status: "unavailable" },
  ),
  createClient: vi.fn(),
  authHeaders: {
    "Cache-Control":
      "private, no-cache, no-store, must-revalidate, max-age=0",
    Expires: "0",
    Pragma: "no-cache",
  },
  ensurePrestataireForUser: vi.fn(async () => undefined),
  exchangeCodeForSession: vi.fn(async () => ({
    error: null as null | { code: string; name: string; status: number },
  })),
  getUser: vi.fn(async () => ({
    data: {
      user: {
        id: "11111111-1111-4111-8111-111111111111",
        email_confirmed_at: "2026-07-21T00:00:00.000Z",
      },
    },
  })),
  logServerEvent: vi.fn(),
}));

vi.mock("@/lib/auth/rate-limit", () => ({
  evaluateAuthRateLimit: mocks.evaluateAuthRateLimit,
}));
vi.mock("@/lib/auth/ensure-prestataire", () => ({
  ensurePrestataireForUser: mocks.ensurePrestataireForUser,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));
vi.mock("@/lib/observability/server-logger", () => ({
  logServerEvent: mocks.logServerEvent,
}));

import { GET } from "@/app/auth/callback/route";

describe("callback Auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.evaluateAuthRateLimit.mockResolvedValue({ status: "allowed" });
    mocks.createClient.mockImplementation(async (headers?: Headers) => {
      if (headers) {
        for (const [name, value] of Object.entries(mocks.authHeaders)) {
          headers.set(name, value);
        }
      }
      return {
      auth: {
        exchangeCodeForSession: mocks.exchangeCodeForSession,
        getUser: mocks.getUser,
      },
      };
    });
  });

  function expectPrivateCallbackRedirect(response: Response) {
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect([...response.headers.values()].join(" ")).not.toContain("secret-code");
  }

  it("ne sollicite aucun service si le code est absent", async () => {
    const response = await GET(
      new Request("http://localhost/auth/callback?next=/app"),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost/connexion?erreur=callback",
    );
    expect(mocks.evaluateAuthRateLimit).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expectPrivateCallbackRedirect(response);
  });

  it("refuse un callback limité avant l'échange du code", async () => {
    mocks.evaluateAuthRateLimit.mockResolvedValueOnce({
      status: "limited",
      resetAt: "2026-07-21T20:10:00.000Z",
    });
    const request = new Request(
      "http://localhost/auth/callback?code=secret-code&next=/app",
      { headers: { "x-vercel-forwarded-for": "203.0.113.8" } },
    );

    const response = await GET(request);

    expect(response.headers.get("location")).toBe(
      "http://localhost/connexion?erreur=callback",
    );
    expect(mocks.evaluateAuthRateLimit).toHaveBeenCalledWith({
      operation: "callback",
      requestHeaders: request.headers,
      identity: "secret-code",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expectPrivateCallbackRedirect(response);
  });

  it("échoue fermé avec la même erreur générique si le quota est indisponible", async () => {
    mocks.evaluateAuthRateLimit.mockResolvedValueOnce({
      status: "unavailable",
    });

    const response = await GET(
      new Request("http://localhost/auth/callback?code=secret-code"),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost/connexion?erreur=callback",
    );
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expectPrivateCallbackRedirect(response);
  });

  it("échange le code seulement après autorisation persistante", async () => {
    const response = await GET(
      new Request("http://localhost/auth/callback?code=valid-code&next=/app"),
    );

    expect(response.headers.get("location")).toBe("http://localhost/app");
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("valid-code");
    expect(mocks.ensurePrestataireForUser).toHaveBeenCalledOnce();
    expect(mocks.createClient).toHaveBeenCalledWith(expect.any(Headers));
    expectPrivateCallbackRedirect(response);
  });

  it("corrèle un échec d'échange sans journaliser le code callback", async () => {
    const requestId = "11111111-1111-4111-8111-111111111111";
    mocks.exchangeCodeForSession.mockResolvedValueOnce({
      error: { code: "exchange_failed", name: "AuthError", status: 400 },
    });

    const response = await GET(
      new Request("http://localhost/auth/callback?code=secret-code", {
        headers: { "x-sidian-request-id": requestId },
      }),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost/connexion?erreur=callback",
    );
    expect(mocks.logServerEvent).toHaveBeenCalledWith(
      "warn",
      "auth.callback_failed",
      {
        requestId,
        stage: "exchange_code",
        errorCode: "exchange_failed",
        status: 400,
      },
    );
    expect(JSON.stringify(mocks.logServerEvent.mock.calls)).not.toContain(
      "secret-code",
    );
  });

  it("refuse un code démesuré avant tout HMAC ou appel Supabase", async () => {
    const response = await GET(
      new Request(
        `http://localhost/auth/callback?code=${"a".repeat(2_049)}`,
      ),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost/connexion?erreur=callback",
    );
    expect(mocks.evaluateAuthRateLimit).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expectPrivateCallbackRedirect(response);
  });
});
