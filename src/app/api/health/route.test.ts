import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET, isHealthOperational } from "./route";

const originalEnvironment = {
  vercel: process.env.VERCEL_ENV,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
};

describe.sequential("GET /api/health", () => {
  beforeEach(() => {
    delete process.env.VERCEL_ENV;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  afterEach(() => {
    if (originalEnvironment.vercel === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalEnvironment.vercel;

    if (originalEnvironment.supabaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = originalEnvironment.supabaseUrl;
    }

    if (originalEnvironment.supabaseAnonKey === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
        originalEnvironment.supabaseAnonKey;
    }
  });

  it("tolère une base non configurée uniquement en local", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      environment: "local",
      database: "not_configured",
    });
  });

  it("échoue fermé en Preview quand Supabase n'est pas configuré", async () => {
    process.env.VERCEL_ENV = "preview";

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "unavailable",
      environment: "preview",
      database: "not_configured",
    });
  });

  it("considère seulement une dépendance connectée comme saine hors local", () => {
    expect(isHealthOperational("connected", "preview")).toBe(true);
    expect(isHealthOperational("not_configured", "preview")).toBe(false);
    expect(isHealthOperational("unavailable", "local")).toBe(false);
  });
});
