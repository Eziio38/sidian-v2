import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET, isHealthOperational } from "./route";

const CRON_SECRET = "cron_secret_de_test_32_caracteres";

const originalEnvironment = {
  VERCEL_ENV: process.env.VERCEL_ENV,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  CRON_SECRET: process.env.CRON_SECRET,
  SIDIAN_LLM_BUDGET_BACKEND: process.env.SIDIAN_LLM_BUDGET_BACKEND,
  SIDIAN_ERROR_REPORTING: process.env.SIDIAN_ERROR_REPORTING,
};

function healthRequest(init?: RequestInit): Request {
  return new Request("http://localhost/api/health", init);
}

function authorized(): Request {
  return healthRequest({
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

describe.sequential("GET /api/health", () => {
  beforeEach(() => {
    delete process.env.VERCEL_ENV;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SIDIAN_LLM_BUDGET_BACKEND;
    delete process.env.SIDIAN_ERROR_REPORTING;
    process.env.CRON_SECRET = CRON_SECRET;
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("tolère une base non configurée uniquement en local", async () => {
    const response = await GET(healthRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      app: "sidian-v2",
    });
  });

  it("échoue fermé en Preview quand Supabase n'est pas configuré", async () => {
    process.env.VERCEL_ENV = "preview";

    const response = await GET(healthRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "unavailable",
      app: "sidian-v2",
    });
  });

  it("n'expose ni environnement, ni base, ni providers sans authentification", async () => {
    process.env.VERCEL_ENV = "production";

    const body = await (await GET(healthRequest())).json();

    expect(body).not.toHaveProperty("environment");
    expect(body).not.toHaveProperty("database");
    expect(body).not.toHaveProperty("llm");
    expect(body).not.toHaveProperty("llm_budget");
    expect(body).not.toHaveProperty("migration_head");
  });

  it("rend la même réponse minimale sur bearer invalide", async () => {
    const response = await GET(
      healthRequest({ headers: { authorization: "Bearer mauvais-secret" } }),
    );

    await expect(response.json()).resolves.toEqual({
      status: "ok",
      app: "sidian-v2",
    });
  });

  it("refuse un secret passé en query string", async () => {
    const response = await GET(
      new Request(
        `http://localhost/api/health?secret=${encodeURIComponent(CRON_SECRET)}`,
        { headers: { authorization: `Bearer ${CRON_SECRET}` } },
      ),
    );

    await expect(response.json()).resolves.toEqual({
      status: "ok",
      app: "sidian-v2",
    });
  });

  it("expose le diagnostic derrière le bearer CRON_SECRET", async () => {
    const body = await (await GET(authorized())).json();

    expect(body).toMatchObject({
      status: "ok",
      app: "sidian-v2",
      environment: "local",
      database: "not_configured",
      llm_budget: {
        backend: "memory",
        durable: false,
        explicitly_configured: false,
      },
      error_reporting: {
        backend: "off",
        provider: "noop",
        configured: false,
      },
    });
    expect(body.llm).toBeDefined();
    expect(body).toHaveProperty("migration_head");
  });

  it("rapporte le backend de budget durable lorsqu'il est configuré", async () => {
    process.env.SIDIAN_LLM_BUDGET_BACKEND = "postgres";

    const body = await (await GET(authorized())).json();

    expect(body.llm_budget).toEqual({
      backend: "postgres",
      durable: true,
      explicitly_configured: true,
    });
  });

  it("ne rend aucune valeur de secret dans le diagnostic", async () => {
    const raw = await (await GET(authorized())).text();

    expect(raw).not.toContain(CRON_SECRET);
    expect(raw).not.toMatch(/sk_live_|sk_test_|whsec_|eyJ[A-Za-z0-9_-]{8,}\./);
  });

  it("échoue fermé sans CRON_SECRET : diagnostic inaccessible", async () => {
    delete process.env.CRON_SECRET;

    const body = await (
      await GET(
        healthRequest({ headers: { authorization: "Bearer peu-importe" } }),
      )
    ).json();

    expect(body).toEqual({ status: "ok", app: "sidian-v2" });
  });

  it("considère seulement une dépendance connectée comme saine hors local", () => {
    expect(isHealthOperational("connected", "preview")).toBe(true);
    expect(isHealthOperational("not_configured", "preview")).toBe(false);
    expect(isHealthOperational("unavailable", "local")).toBe(false);
  });
});
