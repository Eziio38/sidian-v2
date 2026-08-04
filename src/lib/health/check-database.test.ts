import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  configured: true,
  environment: "local" as "local" | "staging" | "production",
  queryError: null as { code: string; message: string } | null,
  thrownError: null as Error | null,
  assertSupabaseDeploymentEnvironment: vi.fn(async () => undefined),
  createClient: vi.fn(),
}));

vi.mock("@/config/env-public", () => ({
  getSupabasePublicEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-test",
  }),
  isSupabasePublicEnvConfigured: () => state.configured,
}));

vi.mock("@/config/env-server", () => ({
  getApplicationEnvironment: () => state.environment,
}));

vi.mock("@/lib/supabase/environment-attestation", () => ({
  assertSupabaseDeploymentEnvironment:
    state.assertSupabaseDeploymentEnvironment,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: state.createClient,
}));

import { checkDatabaseHealth } from "@/lib/health/check-database";

describe("sonde Supabase stricte", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.configured = true;
    state.environment = "local";
    state.queryError = null;
    state.thrownError = null;
    state.assertSupabaseDeploymentEnvironment.mockResolvedValue(undefined);
    state.createClient.mockImplementation(() => ({
      from: () => ({
        select: () => ({
          limit: async () => {
            if (state.thrownError) throw state.thrownError;
            return { error: state.queryError };
          },
        }),
      }),
    }));
  });

  it("distingue une configuration absente d'une dépendance saine", async () => {
    state.configured = false;

    await expect(checkDatabaseHealth()).resolves.toBe("not_configured");
    expect(state.createClient).not.toHaveBeenCalled();
  });

  it("retourne connected uniquement après une requête réellement réussie", async () => {
    await expect(checkDatabaseHealth()).resolves.toBe("connected");
  });

  it.each([
    { code: "PGRST301", message: "invalid api key" },
    { code: "42501", message: "permission denied" },
    { code: "XX000", message: "database error" },
  ])("échoue fermé pour l'erreur PostgREST $code", async (queryError) => {
    state.queryError = queryError;

    await expect(checkDatabaseHealth()).resolves.toBe("unavailable");
  });

  it("échoue fermé lors d'un timeout réseau", async () => {
    state.thrownError = new DOMException("aborted", "AbortError");

    await expect(checkDatabaseHealth()).resolves.toBe("unavailable");
  });

  it("exige l'attestation et la service_role hors local", async () => {
    state.environment = "staging";
    state.assertSupabaseDeploymentEnvironment.mockRejectedValueOnce(
      new Error("service_role_attestation_failed"),
    );

    await expect(checkDatabaseHealth()).resolves.toBe("unavailable");
    expect(state.createClient).not.toHaveBeenCalled();
  });
});
