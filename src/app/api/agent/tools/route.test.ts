/**
 * Tests HTTP route POST /api/agent/tools (G1-L) — délégation au handler.
 *
 * Convention dépôt : tests colocalisés (route.test.ts) comme /api/health.
 * La logique métier est couverte sous src/lib/agent/server (fichiers *.test.ts) ;
 * ici on vérifie uniquement que la route câble createAgentToolsRouteHandler.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const createAgentToolsRouteHandler = vi.hoisted(() =>
  vi.fn(async () =>
    vi.fn(async () =>
      Response.json(
        {
          request_id: "req_route_g1l",
          correlation_id: "corr_route_g1l",
          status: "success",
          code: "OK",
          data: { tool_id: "invoice.get" },
          degraded: { observability: false },
        },
        { status: 200 },
      ),
    ),
  ),
);

vi.mock("@/lib/agent/server/auth", () => ({
  createAgentToolsRouteHandler,
}));

describe("POST /api/agent/tools (G1-L route)", () => {
  beforeEach(() => {
    createAgentToolsRouteHandler.mockClear();
  });

  it("délègue à createAgentToolsRouteHandler puis exécute le handler", async () => {
    const { POST } = await import("./route");
    const request = new Request("http://127.0.0.1:3000/api/agent/tools", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tool_id: "invoice.get",
        tool_version: "1.0.0",
        mode: "agir",
        requested_autonomy_level: 1,
        arguments: { invoice_id: "inv_1" },
      }),
    });

    const response = await POST(request);
    expect(createAgentToolsRouteHandler).toHaveBeenCalledTimes(1);
    expect(createAgentToolsRouteHandler).toHaveBeenCalledWith(request);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "success",
      code: "OK",
    });
  });
});
