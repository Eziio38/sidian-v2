import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type MockProxyOptions = {
  cookieOptions: {
    httpOnly: boolean;
    path: string;
    sameSite: "lax";
    secure: boolean;
  };
  cookies: {
    setAll: (
      cookies: Array<{
        name: string;
        value: string;
        options: { httpOnly: boolean; path: string; sameSite: "lax" };
      }>,
      headers: Record<string, string>,
    ) => void;
  };
};

const authState = vi.hoisted(() => ({
  user: null as { id: string } | null,
  refreshCookie: false,
  createdClients: 0,
  cookieOptions: null as MockProxyOptions["cookieOptions"] | null,
  assertSupabaseDeploymentEnvironment: vi.fn(async () => undefined),
}));

vi.mock("@/config/env-public", () => ({
  getSupabasePublicEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  }),
  isSupabasePublicEnvConfigured: () => true,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _anonKey: string,
    options: MockProxyOptions,
  ) => {
    authState.createdClients += 1;
    authState.cookieOptions = options.cookieOptions;

    return {
      auth: {
        getUser: async () => {
          if (authState.refreshCookie) {
            options.cookies.setAll(
              [
                {
                  name: "sb-session",
                  value: "refreshed",
                  options: options.cookieOptions,
                },
              ],
              {
                "Cache-Control":
                  "private, no-cache, no-store, must-revalidate, max-age=0",
                Expires: "0",
                Pragma: "no-cache",
              },
            );
          }

          return { data: { user: authState.user }, error: null };
        },
      },
    };
  },
}));
vi.mock("@/lib/supabase/environment-attestation", () => ({
  assertSupabaseDeploymentEnvironment:
    authState.assertSupabaseDeploymentEnvironment,
}));

import { REQUEST_ID_HEADER } from "@/lib/observability/request-id";
import { proxy } from "./proxy";

describe("proxy de session et corrélation", () => {
  beforeEach(() => {
    authState.user = null;
    authState.refreshCookie = false;
    authState.createdClients = 0;
    authState.cookieOptions = null;
    authState.assertSupabaseDeploymentEnvironment.mockResolvedValue(undefined);
    vi.stubEnv("VERCEL_ENV", "preview");
  });

  it("redirige /app après getUser négatif, même avec un cookie entrant", async () => {
    authState.refreshCookie = true;
    const request = new NextRequest("https://preview.example.test/app/clients", {
      headers: {
        cookie: "sb-session=attacker-controlled",
        [REQUEST_ID_HEADER]: "attacker-controlled",
      },
    });

    const response = await proxy(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://preview.example.test/connexion?erreur=session",
    );
    expect(response.headers.get("set-cookie")).toContain(
      "sb-session=refreshed",
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get(REQUEST_ID_HEADER)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(response.headers.get(REQUEST_ID_HEADER)).not.toBe(
      "attacker-controlled",
    );
  });

  it("laisse passer un utilisateur vérifié et propage le même identifiant", async () => {
    authState.user = { id: "user-1" };
    const request = new NextRequest("https://preview.example.test/app");

    const response = await proxy(request);
    const responseRequestId = response.headers.get(REQUEST_ID_HEADER);

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(responseRequestId).toBeTruthy();
    expect(
      response.headers.get(`x-middleware-request-${REQUEST_ID_HEADER}`),
    ).toBe(responseRequestId);
  });

  it("échoue fermé avant tout cookie Supabase si l'environnement n'est pas attesté", async () => {
    authState.assertSupabaseDeploymentEnvironment.mockRejectedValueOnce(
      new Error("environment_attestation_failed"),
    );
    const request = new NextRequest("https://preview.example.test/app", {
      headers: { cookie: "sb-session=must-not-leak" },
    });

    const response = await proxy(request);

    expect(response.status).toBe(503);
    expect(authState.createdClients).toBe(0);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBeTruthy();
  });

  it("ne transforme pas une route publique en contrôle d'autorisation", async () => {
    const request = new NextRequest("https://preview.example.test/connexion");

    const response = await proxy(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(authState.createdClients).toBe(0);
  });

  it.each([
    "/api/stripe/webhook",
    "/api/health",
    "/p/token-public",
    "/auth/callback?code=secret",
  ])("ne contacte jamais Supabase avant la route publique %s", async (path) => {
    const request = new NextRequest(`https://preview.example.test${path}`, {
      headers: { cookie: "sb-session=attacker-controlled" },
    });

    const response = await proxy(request);

    expect(response.status).toBe(200);
    expect(authState.createdClients).toBe(0);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBeTruthy();
  });
});
