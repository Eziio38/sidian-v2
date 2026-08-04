/**
 * Tests G1-L — Server Entry Point (HTTP handler).
 *
 * Importe l’API production `@/lib/agent/server`.
 * Gateway + Router mémoire injectés — zéro réseau.
 *
 * Couverture unitaire 1–45 (brief G1-L) :
 * 1 POST nominal · 2–7 méthode/Content-Type/JSON/taille
 * 8–15 champs confiance refusés · 16–21 sessions/memberships
 * 22–23 tenant · 24–26 ordre Gateway/Router
 * 27–31 mapping résultats · 32–37 sanitization
 * 38–40 ids / input · 41–43 timeouts/annulation
 * 44 audit échec auth · 45 obs best-effort
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_AGENT_SERVER_LIMITS } from "@/lib/agent/server";

import {
  APPROVAL_ID,
  BEARER_TOKEN_EXPIRED,
  BEARER_TOKEN_INVALID,
  BEARER_TOKEN_VALID,
  CORRELATION_ID,
  PRINCIPAL_SUBJECT_A,
  REQUEST_ID,
  SENSITIVE_APP_SECRET,
  SENSITIVE_COOKIE_VALUE,
  SENSITIVE_RAW_JWT,
  SENSITIVE_SQL_FRAGMENT,
  SENSITIVE_STACK_FRAGMENT,
  TENANT_A_UUID,
  TENANT_B_UUID,
  createAgentHttpRequest,
  createAgentServerHarnessWithFailingObservability,
  createAgentServerHarnessWithIdempotency,
  createAgentServerTestHarness,
  expectErrorResponse,
  expectNoSensitiveHttpLeak,
  expectSuccessResponse,
  nominalExternalBody,
  poisonedExternalBody,
  readJsonBody,
} from "./test-fixtures";

describe("AgentServerHandler G1-L (HTTP, mocks injectés)", () => {
  // -------------------------------------------------------------------------
  // 1 · Nominale
  // -------------------------------------------------------------------------

  it("1. POST authentifié nominal → 200 success sanitizé", async () => {
    const { handler, router, gateway, pipeline } =
      createAgentServerTestHarness();

    const response = await handler(createAgentHttpRequest());
    const body = await expectSuccessResponse(response);

    expect(body.request_id).toBe(REQUEST_ID);
    expect(body.correlation_id).toBe(CORRELATION_ID);
    expect(body.data.tool_id).toBe("invoice.get");
    expect(body.data.output).toEqual(
      expect.objectContaining({ invoice_id: expect.any(String) }),
    );
    expect(gateway.callCount()).toBe(1);
    expect(router.callCount()).toBe(1);
    expect(pipeline.phases).toEqual(["gateway", "router"]);
  });

  // -------------------------------------------------------------------------
  // 2–7 · Méthode / Content-Type / JSON / taille
  // -------------------------------------------------------------------------

  it("2. méthode non autorisée → 405 HTTP_METHOD_NOT_ALLOWED", async () => {
    const { handler, gateway, router } = createAgentServerTestHarness();

    const response = await handler(
      createAgentHttpRequest({ method: "GET", rawBody: undefined, body: undefined }),
    );

    await expectErrorResponse(response, {
      httpStatus: 405,
      code: "HTTP_METHOD_NOT_ALLOWED",
    });
    expect(response.headers.get("allow")).toContain("POST");
    expect(gateway.callCount()).toBe(0);
    expect(router.callCount()).toBe(0);
  });

  it("3. Content-Type absent → 415 HTTP_CONTENT_TYPE_REQUIRED", async () => {
    const { handler, gateway } = createAgentServerTestHarness();

    const response = await handler(
      createAgentHttpRequest({ contentType: null }),
    );

    await expectErrorResponse(response, {
      httpStatus: 415,
      code: "HTTP_CONTENT_TYPE_REQUIRED",
    });
    expect(gateway.callCount()).toBe(0);
  });

  it("4. Content-Type incorrect → 415 HTTP_CONTENT_TYPE_UNSUPPORTED", async () => {
    const { handler, gateway } = createAgentServerTestHarness();

    const response = await handler(
      createAgentHttpRequest({ contentType: "text/plain" }),
    );

    await expectErrorResponse(response, {
      httpStatus: 415,
      code: "HTTP_CONTENT_TYPE_UNSUPPORTED",
    });
    expect(gateway.callCount()).toBe(0);
  });

  it("5. JSON invalide → 400 HTTP_BODY_INVALID", async () => {
    const { handler, gateway } = createAgentServerTestHarness();

    const response = await handler(
      createAgentHttpRequest({ rawBody: "{not-json" }),
    );

    await expectErrorResponse(response, {
      httpStatus: 400,
      code: "HTTP_BODY_INVALID",
    });
    expect(gateway.callCount()).toBe(0);
  });

  it("6. body vide → 400 HTTP_BODY_INVALID", async () => {
    const { handler, gateway } = createAgentServerTestHarness();

    const response = await handler(createAgentHttpRequest({ rawBody: "   " }));

    await expectErrorResponse(response, {
      httpStatus: 400,
      code: "HTTP_BODY_INVALID",
    });
    expect(gateway.callCount()).toBe(0);
  });

  it("7. body trop volumineux → 413 HTTP_BODY_TOO_LARGE", async () => {
    const maxBytes = 64;
    const { handler, gateway } = createAgentServerTestHarness({
      limits: { max_body_bytes: maxBytes },
    });

    const oversized = "x".repeat(maxBytes + 1);
    const response = await handler(
      createAgentHttpRequest({
        rawBody: oversized,
        headers: { "content-length": String(oversized.length) },
      }),
    );

    await expectErrorResponse(response, {
      httpStatus: 413,
      code: "HTTP_BODY_TOO_LARGE",
    });
    expect(gateway.callCount()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 8–15 · Champs confiance / poison refusés
  // -------------------------------------------------------------------------

  it.each([
    ["8. champ inconnu", "unknown_client_field", "surprise"],
    ["9. tenant_id dans body", "tenant_id", TENANT_B_UUID],
    ["10. actor_id dans body", "actor_id", "actor_spoof"],
    ["11. roles dans body", "roles", ["owner", "admin"]],
    [
      "12. TrustedExecutionContext dans body",
      "TrustedExecutionContext",
      {
        tenant_id: TENANT_B_UUID,
        actor_id: "spoof",
        trust_level: "authenticated_tenant_member",
      },
    ],
    [
      "13. ToolDefinition dans body",
      "tool_definition",
      { tool_id: "evil", executor: "fn" },
    ],
    ["14. executor dans body", "executor", "() => {}"],
    ["15. token dans body", "access_token", SENSITIVE_RAW_JWT],
  ] as const)("%s refusé → 400 HTTP_REQUEST_INVALID", async (_label, field, value) => {
    const { handler, gateway, router } = createAgentServerTestHarness();

    const response = await handler(
      createAgentHttpRequest({ body: poisonedExternalBody(field, value) }),
    );

    await expectErrorResponse(response, {
      httpStatus: 400,
      code: "HTTP_REQUEST_INVALID",
    });
    expect(gateway.callCount()).toBe(0);
    expect(router.callCount()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 16–21 · Sessions / memberships
  // -------------------------------------------------------------------------

  it("16. session absente → 401 AUTHENTICATION_REQUIRED", async () => {
    const { handler, router } = createAgentServerTestHarness();

    const response = await handler(createAgentHttpRequest({ bearer: null }));

    await expectErrorResponse(response, {
      httpStatus: 401,
      code: "AUTHENTICATION_REQUIRED",
    });
    expect(router.callCount()).toBe(0);
  });

  it("17. session invalide → 401 AUTHENTICATION_INVALID", async () => {
    const { handler, router } = createAgentServerTestHarness();

    const response = await handler(
      createAgentHttpRequest({ bearer: BEARER_TOKEN_INVALID }),
    );

    await expectErrorResponse(response, {
      httpStatus: 401,
      code: "AUTHENTICATION_INVALID",
    });
    expect(router.callCount()).toBe(0);
  });

  it("18. session expirée → 401 AUTHENTICATION_INVALID", async () => {
    const { handler, router } = createAgentServerTestHarness();

    const response = await handler(
      createAgentHttpRequest({ bearer: BEARER_TOKEN_EXPIRED }),
    );

    await expectErrorResponse(response, {
      httpStatus: 401,
      code: "AUTHENTICATION_INVALID",
    });
    expect(router.callCount()).toBe(0);
  });

  it("19. service auth indisponible → 503 AGENT_DEPENDENCY_UNAVAILABLE", async () => {
    const { handler, principalResolver, router } =
      createAgentServerTestHarness();
    principalResolver.setOutcome({ outcome: "unavailable" });

    const response = await handler(createAgentHttpRequest());

    await expectErrorResponse(response, {
      httpStatus: 503,
      code: "AGENT_DEPENDENCY_UNAVAILABLE",
    });
    expect(router.callCount()).toBe(0);
  });

  it("20. membership absente → 403 TENANT_ACCESS_DENIED", async () => {
    const { handler, membershipResolver, router } =
      createAgentServerTestHarness();
    membershipResolver.setMemberships(PRINCIPAL_SUBJECT_A, []);

    const response = await handler(createAgentHttpRequest());

    await expectErrorResponse(response, {
      httpStatus: 403,
      code: "TENANT_ACCESS_DENIED",
    });
    expect(router.callCount()).toBe(0);
  });

  it("21. membership inactive → 403 TENANT_ACCESS_DENIED", async () => {
    const { handler, membershipResolver, router } =
      createAgentServerTestHarness();
    membershipResolver.setMemberships(PRINCIPAL_SUBJECT_A, [
      { tenant_id: TENANT_A_UUID, roles: ["owner"], status: "inactive" },
    ]);

    const response = await handler(createAgentHttpRequest());

    await expectErrorResponse(response, {
      httpStatus: 403,
      code: "TENANT_ACCESS_DENIED",
    });
    expect(router.callCount()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 22–23 · Tenant autorisé / non autorisé
  // -------------------------------------------------------------------------

  it("22. tenant autorisé (hint A) → 200 + contexte tenant A", async () => {
    const { handler, router } = createAgentServerTestHarness();

    const response = await handler(
      createAgentHttpRequest({ tenantHint: TENANT_A_UUID }),
    );
    await expectSuccessResponse(response);

    expect(router.callCount()).toBe(1);
    const ctx = router.routeCalls[0]!.context as { tenant_id: string };
    expect(ctx.tenant_id).toBe(TENANT_A_UUID);
  });

  it("23. tenant non autorisé (hint B) → 403 TENANT_ACCESS_DENIED", async () => {
    const { handler, router } = createAgentServerTestHarness();

    const response = await handler(
      createAgentHttpRequest({ tenantHint: TENANT_B_UUID }),
    );

    await expectErrorResponse(response, {
      httpStatus: 403,
      code: "TENANT_ACCESS_DENIED",
    });
    expect(router.callCount()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 24–26 · Ordre Gateway → Router
  // -------------------------------------------------------------------------

  it("24. Router jamais appelé avant Gateway authenticated", async () => {
    const { handler, pipeline, router } = createAgentServerTestHarness();

    await handler(createAgentHttpRequest({ bearer: BEARER_TOKEN_INVALID }));

    expect(pipeline.phases).toEqual(["gateway"]);
    expect(router.callCount()).toBe(0);
  });

  it("25. Router appelé exactement une fois sur succès", async () => {
    const { handler, router, gateway } = createAgentServerTestHarness();

    await handler(createAgentHttpRequest());

    expect(gateway.callCount()).toBe(1);
    expect(router.callCount()).toBe(1);
  });

  it("26. Router non appelé sur échec Gateway", async () => {
    const { handler, router, gateway } = createAgentServerTestHarness();

    await handler(createAgentHttpRequest({ bearer: null }));

    expect(gateway.callCount()).toBe(1);
    expect(router.callCount()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 27–31 · Mapping résultats Router → HTTP
  // -------------------------------------------------------------------------

  it("27. réponse succès sanitizée (pas de contexte/token)", async () => {
    const { handler } = createAgentServerTestHarness();

    const response = await handler(createAgentHttpRequest());
    const body = await expectSuccessResponse(response);

    expect(body.data).not.toHaveProperty("tenant_id");
    expect(body.data).not.toHaveProperty("actor_id");
    expect(body.data).not.toHaveProperty("TrustedExecutionContext");
    expect(body.data).not.toHaveProperty("bearer_token");
    expectNoSensitiveHttpLeak(body);
  });

  it("28. deny correctement traduit → 403 PERMISSION_DENIED", async () => {
    const { handler, router } = createAgentServerTestHarness({
      permissionMode: "deny",
    });

    const response = await handler(createAgentHttpRequest());
    const body = await expectErrorResponse(response, {
      httpStatus: 403,
      code: "PERMISSION_DENIED",
      status: "blocked",
    });
    expect(router.callCount()).toBe(1);
    expect(body.data.message).toEqual(expect.any(String));
  });

  it("29. require_approval correctement traduit → 202 APPROVAL_REQUIRED", async () => {
    const { handler } = createAgentServerTestHarness({
      permissionMode: "require_approval",
    });

    const response = await handler(createAgentHttpRequest());
    const body = await readJsonBody(response);

    expect(response.status).toBe(202);
    expect(body.status).toBe("pending");
    expect(body.code).toBe("APPROVAL_REQUIRED");
    expectNoSensitiveHttpLeak(body);
  });

  it("30. idempotency conflict correctement traduit → 409", async () => {
    const { handler } = createAgentServerHarnessWithIdempotency({
      decision: "conflict",
      code: "IDEMPOTENCY_KEY_CONFLICT",
    });

    const response = await handler(
      createAgentHttpRequest({
        body: nominalExternalBody({
          idempotency_key: "idem_g1l_conflict",
        }),
      }),
    );
    const body = await readJsonBody(response);

    expect(response.status).toBe(409);
    expect(body.status).toBe("blocked");
    expect(body.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
    expectNoSensitiveHttpLeak(body);
  });

  it("31. in_progress correctement traduit → 202 IDEMPOTENCY_IN_PROGRESS", async () => {
    const { handler } = createAgentServerHarnessWithIdempotency({
      decision: "in_progress",
      code: "IDEMPOTENCY_IN_PROGRESS",
      expires_at: "2026-07-25T12:00:00.000Z",
    });

    const response = await handler(
      createAgentHttpRequest({
        body: nominalExternalBody({
          idempotency_key: "idem_g1l_in_progress",
        }),
      }),
    );
    const body = await readJsonBody(response);

    expect(response.status).toBe(202);
    expect(body.status).toBe("pending");
    expect(body.code).toBe("IDEMPOTENCY_IN_PROGRESS");
    expectNoSensitiveHttpLeak(body);
  });

  // -------------------------------------------------------------------------
  // 32–37 · Sanitization erreurs / secrets
  // -------------------------------------------------------------------------

  it("32. erreur technique masquée → 500 sans détail brut", async () => {
    const { handler } = createAgentServerTestHarness({
      router: {
        routeResult: async () => {
          throw new Error(
            `boom ${SENSITIVE_STACK_FRAGMENT}\n    at Object.route\n${SENSITIVE_SQL_FRAGMENT}`,
          );
        },
      },
    });

    const response = await handler(createAgentHttpRequest());
    const body = await expectErrorResponse(response, {
      httpStatus: 500,
      code: "INTERNAL_SERVER_ERROR",
    });
    expect(JSON.stringify(body)).not.toContain("boom");
  });

  it("33. stack absente de la réponse", async () => {
    const { handler, principalResolver } = createAgentServerTestHarness();
    principalResolver.setOutcome("throw");

    const response = await handler(createAgentHttpRequest());
    const body = await readJsonBody(response);

    expect(JSON.stringify(body)).not.toMatch(/"stack"\s*:/);
    expect(JSON.stringify(body)).not.toContain(SENSITIVE_STACK_FRAGMENT);
    expect(JSON.stringify(body)).not.toContain("at Object.");
  });

  it("34. SQL brut absent", async () => {
    const { handler, membershipResolver } = createAgentServerTestHarness();
    membershipResolver.setNextOutcome("throw");
    membershipResolver.setThrowRaw(
      new Error(`relation does not exist ${SENSITIVE_SQL_FRAGMENT}`),
    );

    const response = await handler(createAgentHttpRequest());
    const serialized = JSON.stringify(await response.json());

    expect(serialized).not.toContain("SELECT * FROM");
    expect(serialized).not.toContain(SENSITIVE_SQL_FRAGMENT);
  });

  it("35. JWT absent de la réponse", async () => {
    const { handler } = createAgentServerTestHarness();

    const response = await handler(
      createAgentHttpRequest({
        bearer: BEARER_TOKEN_VALID,
        headers: { "x-debug-jwt": SENSITIVE_RAW_JWT },
      }),
    );
    const body = await expectSuccessResponse(response);
    expect(JSON.stringify(body)).not.toContain(SENSITIVE_RAW_JWT);
    expect(JSON.stringify(body)).not.toContain("eyJhbGciOi");
  });

  it("36. cookie absent de la réponse", async () => {
    const { handler } = createAgentServerTestHarness();

    const response = await handler(
      createAgentHttpRequest({
        headers: { cookie: SENSITIVE_COOKIE_VALUE },
      }),
    );
    const body = await expectSuccessResponse(response);
    expect(JSON.stringify(body)).not.toContain("g1l_SENSITIVE_COOKIE");
    expect(JSON.stringify(body)).not.toContain("sb-127-auth-token");
  });

  it("37. secret absent de la réponse", async () => {
    const { handler } = createAgentServerTestHarness({
      router: {
        routeResult: async () => {
          throw new Error(`secret=${SENSITIVE_APP_SECRET}`);
        },
      },
    });

    const response = await handler(createAgentHttpRequest());
    const body = await expectErrorResponse(response, {
      httpStatus: 500,
      code: "INTERNAL_SERVER_ERROR",
    });
    expect(JSON.stringify(body)).not.toContain(SENSITIVE_APP_SECRET);
  });

  // -------------------------------------------------------------------------
  // 38–40 · Identifiants / input
  // -------------------------------------------------------------------------

  it("38. request_id présent", async () => {
    const { handler } = createAgentServerTestHarness();

    const response = await handler(createAgentHttpRequest());
    const body = await expectSuccessResponse(response);
    expect(body.request_id).toBe(REQUEST_ID);
  });

  it("39. correlation_id cohérent (body → réponse)", async () => {
    const { handler, router, gateway } = createAgentServerTestHarness();
    const corr = "corr_g1l_coherent";

    const response = await handler(
      createAgentHttpRequest({
        body: nominalExternalBody({ correlation_id: corr }),
      }),
    );
    const body = await expectSuccessResponse(response);

    expect(body.correlation_id).toBe(corr);
    expect(gateway.resolveCalls[0]!.requestMetadata.correlation_id).toBe(corr);
    const ctx = router.routeCalls[0]!.context as { correlation_id: string };
    expect(ctx.correlation_id).toBe(corr);
  });

  it("40. input non muté", async () => {
    const { handler, gateway } = createAgentServerTestHarness();
    const body = nominalExternalBody();
    const snapshot = structuredClone(body);

    await handler(createAgentHttpRequest({ body }));

    expect(body).toEqual(snapshot);
    expect(gateway.resolveCalls[0]!.externalRequest.arguments).toEqual(
      snapshot.arguments,
    );
  });

  // -------------------------------------------------------------------------
  // 41–43 · Timeouts / annulation
  // -------------------------------------------------------------------------

  it("41. timeout avant Router (budget total épuisé) → 408", async () => {
    const { handler, clock, router, gateway } = createAgentServerTestHarness({
      limits: {
        gateway_timeout_ms: 80,
        router_timeout_ms: 80,
        total_timeout_ms: 100,
      },
      gateway: {
        onCall: () => {
          clock.advanceMs(150);
        },
      },
    });

    const response = await handler(createAgentHttpRequest());

    await expectErrorResponse(response, {
      httpStatus: 408,
      code: "HTTP_REQUEST_TIMEOUT",
    });
    expect(gateway.callCount()).toBe(1);
    expect(router.callCount()).toBe(0);
  });

  it("42. timeout pendant Router → 408 HTTP_REQUEST_TIMEOUT", async () => {
    const { handler, router } = createAgentServerTestHarness({
      limits: {
        gateway_timeout_ms: 5_000,
        router_timeout_ms: 30,
        total_timeout_ms: 5_000,
      },
      router: { hang: true },
    });

    const response = await handler(createAgentHttpRequest());

    await expectErrorResponse(response, {
      httpStatus: 408,
      code: "HTTP_REQUEST_TIMEOUT",
    });
    expect(router.callCount()).toBe(1);
  });

  it("43. annulation propagée (AbortSignal) → 408", async () => {
    const controller = new AbortController();
    const { handler, gateway } = createAgentServerTestHarness({
      gateway: {
        delayMs: 50,
        onCall: () => {
          controller.abort();
        },
      },
    });

    const response = await handler(
      createAgentHttpRequest({ signal: controller.signal }),
    );

    await expectErrorResponse(response, {
      httpStatus: 408,
      code: "HTTP_REQUEST_TIMEOUT",
    });
    expect(gateway.callCount()).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 44–45 · Audit / observabilité
  // -------------------------------------------------------------------------

  it("44. audit produit pour route authentifiée échouée (deny)", async () => {
    const { handler, routerHarness, router } = createAgentServerTestHarness({
      permissionMode: "deny",
    });

    const response = await handler(createAgentHttpRequest());
    expect(response.status).toBe(403);
    expect(router.callCount()).toBe(1);

    // Audit append-only côté Router (fail-closed G1-F) — présent sur deny.
    expect(routerHarness.auditSink).not.toBeNull();
    expect(routerHarness.auditSink!.appendCount()).toBeGreaterThanOrEqual(1);
    const audit = routerHarness.auditSink!.events[0]!;
    expect(audit.tenant.tenant_id).toBe(TENANT_A_UUID);
    // Identité vérifiée — pas le tenant spoofé du body (absent ici).
    expect(audit.tenant.tenant_id).not.toBe(TENANT_B_UUID);
  });

  it("45. observabilité dégradée ne modifie pas le résultat principal", async () => {
    const { handler } = createAgentServerHarnessWithFailingObservability();

    const response = await handler(createAgentHttpRequest());
    const body = await expectSuccessResponse(response);

    expect(body.status).toBe("success");
    expect(body.code).toBe("OK");
    expect(body.degraded.observability).toBe(true);
  });

  it("limites par défaut documentées (régression)", () => {
    expect(DEFAULT_AGENT_SERVER_LIMITS.max_body_bytes).toBe(256 * 1024);
    expect(DEFAULT_AGENT_SERVER_LIMITS.gateway_timeout_ms).toBe(5_000);
    expect(DEFAULT_AGENT_SERVER_LIMITS.router_timeout_ms).toBe(25_000);
    expect(DEFAULT_AGENT_SERVER_LIMITS.total_timeout_ms).toBe(30_000);
  });

  it("approval_id métier transmis sans élévation d’identité HTTP", async () => {
    // Garde-fou : approval_id est un champ métier autorisé, pas une identité.
    const { handler, gateway, router } = createAgentServerTestHarness({
      withApproval: true,
    });
    const response = await handler(
      createAgentHttpRequest({
        body: nominalExternalBody({ approval_id: APPROVAL_ID }),
      }),
    );
    // Read tool + approval_id : le handler atteint le Router (Gateway OK).
    expect(gateway.callCount()).toBe(1);
    expect(router.callCount()).toBe(1);
    expect(gateway.resolveCalls[0]!.externalRequest.approval_id).toBe(
      APPROVAL_ID,
    );
    const body = await readJsonBody(response);
    expect(body.data).not.toHaveProperty("tenant_id");
    expect(body.data).not.toHaveProperty("actor_id");
    expectNoSensitiveHttpLeak(body);
  });
});
