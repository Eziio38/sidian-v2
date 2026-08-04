import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logServerEvent: vi.fn(),
}));

vi.mock("@/lib/observability/server-logger", () => ({
  logServerEvent: mocks.logServerEvent,
}));

import {
  handleCronRequest,
  methodNotAllowed,
} from "@/app/api/cron/_lib/handler";

const CRON_SECRET = "cron_secret_de_test_32_caracteres";
const originalSecret = process.env.CRON_SECRET;

function run(request: Request, job: "scanners" | "drains" = "scanners") {
  const runner = vi.fn(async () => ({ ok: true, status: "completed" }));
  return {
    runner,
    response: handleCronRequest({ request, job, run: runner }),
  };
}

describe("handler cron partagé", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalSecret;
    }
  });

  it("refuse en 401 sans en-tête Authorization et n'exécute pas le job", async () => {
    const { runner, response } = run(
      new Request("http://localhost/api/cron/scanners"),
    );

    const result = await response;
    expect(result.status).toBe(401);
    await expect(result.json()).resolves.toMatchObject({
      ok: false,
      error: "unauthorized",
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it("refuse en 401 un bearer incorrect", async () => {
    const { runner, response } = run(
      new Request("http://localhost/api/cron/scanners", {
        headers: { authorization: "Bearer mauvais_secret_de_meme_longueur" },
      }),
    );

    const result = await response;
    expect(result.status).toBe(401);
    expect(runner).not.toHaveBeenCalled();
  });

  it("refuse en 401 un schéma d'auth autre que Bearer", async () => {
    const { runner, response } = run(
      new Request("http://localhost/api/cron/scanners", {
        headers: { authorization: `Basic ${CRON_SECRET}` },
      }),
    );

    expect((await response).status).toBe(401);
    expect(runner).not.toHaveBeenCalled();
  });

  it("échoue fermé en 503 lorsque CRON_SECRET n'est pas configuré", async () => {
    delete process.env.CRON_SECRET;

    const { runner, response } = run(
      new Request("http://localhost/api/cron/drains", {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
      "drains",
    );

    const result = await response;
    expect(result.status).toBe(503);
    await expect(result.json()).resolves.toMatchObject({
      ok: false,
      error: "cron_not_configured",
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it.each([
    "secret",
    "cron_secret",
    "token",
    "authorization",
    "api_key",
    "apikey",
  ])("n'accepte jamais le secret via la query string (?%s=)", async (key) => {
    const { runner, response } = run(
      new Request(
        `http://localhost/api/cron/scanners?${key}=${encodeURIComponent(CRON_SECRET)}`,
      ),
    );

    const result = await response;
    expect(result.status).toBe(401);
    expect(runner).not.toHaveBeenCalled();
  });

  it("refuse même avec un bearer valide si un secret traîne aussi en query", async () => {
    const { runner, response } = run(
      new Request(
        `http://localhost/api/cron/scanners?secret=${encodeURIComponent(CRON_SECRET)}`,
        { headers: { authorization: `Bearer ${CRON_SECRET}` } },
      ),
    );

    expect((await response).status).toBe(401);
    expect(runner).not.toHaveBeenCalled();
  });

  it("ne divulgue jamais le secret dans la réponse ni dans les logs", async () => {
    const { response } = run(new Request("http://localhost/api/cron/scanners"));
    const body = await (await response).text();

    expect(body).not.toContain(CRON_SECRET);
    expect(JSON.stringify(mocks.logServerEvent.mock.calls)).not.toContain(
      CRON_SECRET,
    );
  });

  it("exécute le job avec un bearer valide et interdit la mise en cache", async () => {
    const { runner, response } = run(
      new Request("http://localhost/api/cron/scanners", {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    );

    const result = await response;
    expect(result.status).toBe(200);
    expect(runner).toHaveBeenCalledOnce();
    expect(result.headers.get("cache-control")).toContain("no-store");
  });
});

describe("methodNotAllowed", () => {
  it("répond 405 avec la liste des méthodes autorisées", async () => {
    const response = methodNotAllowed();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, POST");
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "method_not_allowed",
    });
  });

  // Les verbes mutants ne doivent jamais atteindre l'orchestration cron, même
  // authentifiés : ils ne sont pas idempotents côté effets externes.
  it.each(["PUT", "PATCH", "DELETE"] as const)(
    "les routes cron refusent %s en 405",
    async (method) => {
      const [drains, scanners] = await Promise.all([
        import("@/app/api/cron/drains/route"),
        import("@/app/api/cron/scanners/route"),
      ]);

      for (const route of [drains, scanners]) {
        const response = await route[method]();
        expect(response.status).toBe(405);
        expect(response.headers.get("allow")).toBe("GET, POST");
      }
    },
  );
});
