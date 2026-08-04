/**
 * Tests G1-K — Request Gateway (trust boundary).
 *
 * Importe l’API production `@/lib/agent/gateway`.
 * Resolvers mémoire injectés — zéro réseau.
 *
 * Couverture unitaire :
 * 1 requête nominale · 2 schéma strict · 3–9 champs confiance refusés
 * 10–14 tokens · 15–16 acteur/tenant dérivés · 17–20 memberships
 * 21–22 multi-tenant · 23–25 sanitization contexte/audit
 * 26 input non muté · 27–29 erreurs masquées · 30 déterminisme
 */

import { describe, expect, it } from "vitest";

import {
  EXTERNAL_REQUEST_FORBIDDEN_FIELDS,
  GATEWAY_SAFE_MESSAGES,
  createRequestGateway,
  externalToolRequestSchema,
} from "@/lib/agent/gateway";

import {
  ACTOR_ID_A,
  BEARER_TOKEN_ACTOR_DISABLED,
  BEARER_TOKEN_AUDIENCE_MISMATCH,
  BEARER_TOKEN_EXPIRED,
  BEARER_TOKEN_INVALID,
  BEARER_TOKEN_ISSUER_MISMATCH,
  BEARER_TOKEN_VALID,
  CORRELATION_ID,
  FIXED_NOW,
  FIXED_NOW_AFTER_EXPIRY,
  PRINCIPAL_SUBJECT_A,
  RAW_AUTH_PROVIDER_DETAIL,
  REQUEST_ID,
  SENSITIVE_RAW_JWT,
  SENSITIVE_STACK_FRAGMENT,
  TENANT_A_UUID,
  TENANT_B_UUID,
  TENANT_UNKNOWN_UUID,
  absentAuthMaterial,
  baseAuthMaterial,
  baseExternalRequest,
  baseGatewayRequest,
  createGatewayTestHarness,
  createMemoryMembershipResolver,
  createMemoryPrincipalResolver,
  expectNoJwtInContext,
  expectNoSensitiveLeak,
  expectNoTokenInAuditPayload,
  expectNoUselessClaims,
  externalWithForbiddenField,
  multiTenantMemberships,
} from "./test-fixtures";

describe("RequestGateway G1-K (resolve, resolvers injectés)", () => {
  // -------------------------------------------------------------------------
  // 1–2 · Nominale + schéma
  // -------------------------------------------------------------------------

  it("1. requête externe nominale → authenticated + TrustedExecutionContext", async () => {
    const { gateway } = createGatewayTestHarness();

    const result = await gateway.resolve(baseGatewayRequest());

    expect(result.status).toBe("authenticated");
    expect(result.decision).toBe("authenticated");
    if (result.status !== "authenticated") return;

    expect(result.context.tenant_id).toBe(TENANT_A_UUID);
    expect(result.context.actor_id).toBe(ACTOR_ID_A);
    expect(result.context.principal_subject).toBe(PRINCIPAL_SUBJECT_A);
    expect(result.context.trust_level).toBe("authenticated_tenant_member");
    expect(result.context.authentication_method).toBe("supabase_auth_jwt");
    expect(result.context.roles).toEqual(["owner"]);
    expect(result.context.request_id).toBe(REQUEST_ID);
    expect(result.context.correlation_id).toBe(CORRELATION_ID);
    expect(result.context.now).toBe(FIXED_NOW);
    expect(result.external_request.tool_id).toBe("invoice.get");
    expectNoJwtInContext(result.context);
  });

  it("2. schéma externe strict — champs inconnus / formes invalides refusés", async () => {
    const { gateway } = createGatewayTestHarness();

    const unknownField = await gateway.resolve({
      ...baseGatewayRequest(),
      externalRequest: {
        ...baseExternalRequest(),
        prompt_says_allowed: true,
      } as never,
    });
    expect(unknownField.status).toBe("invalid");
    expect(unknownField.decision).toBeNull();
    if (unknownField.status === "invalid") {
      expect(unknownField.error.code).toBe("GATEWAY_INPUT_INVALID");
    }

    const badSchema = externalToolRequestSchema.safeParse({
      tool_id: "invoice.get",
      // tool_version manquant
      mode: "agir",
      requested_autonomy_level: 1,
      arguments: {},
    });
    expect(badSchema.success).toBe(false);

    const emptyTool = await gateway.resolve(
      baseGatewayRequest({
        externalRequest: { tool_id: "" },
      }),
    );
    expect(emptyTool.status).toBe("invalid");
  });

  // -------------------------------------------------------------------------
  // 3–9 · Champs de confiance refusés dans le body
  // -------------------------------------------------------------------------

  it.each([
    ["3. tenant_id", "tenant_id", TENANT_A_UUID],
    ["4. actor_id", "actor_id", ACTOR_ID_A],
    ["5. roles", "roles", ["owner", "admin"]],
    ["6. permissions", "permissions", ["invoice.read"]],
    [
      "7. human_validation",
      "human_validation",
      { status: "approved", validation_id: "hv_1" },
    ],
    [
      "8. tool_definition",
      "tool_definition",
      { tool_id: "evil", tool_version: "9.9.9" },
    ],
    ["9. executor", "executor", { run: "() => {}" }],
  ] as const)(
    "%s dans body → GATEWAY_INPUT_INVALID",
    async (_label, field, value) => {
      const { gateway, principalResolver } = createGatewayTestHarness();

      const result = await gateway.resolve({
        ...baseGatewayRequest(),
        externalRequest: externalWithForbiddenField(field, value) as never,
      });

      expect(result.status).toBe("invalid");
      if (result.status === "invalid") {
        expect(result.error.code).toBe("GATEWAY_INPUT_INVALID");
        expect(result.error.message).toBe(
          GATEWAY_SAFE_MESSAGES.GATEWAY_INPUT_INVALID,
        );
      }
      expect(principalResolver.resolveCalls).toHaveLength(0);
      expect(EXTERNAL_REQUEST_FORBIDDEN_FIELDS).toContain(field);
    },
  );

  // -------------------------------------------------------------------------
  // 10–14 · Tokens / auth
  // -------------------------------------------------------------------------

  it("10. token absent → unauthenticated / AUTHENTICATION_REQUIRED", async () => {
    const { gateway, principalResolver } = createGatewayTestHarness();

    const result = await gateway.resolve(
      baseGatewayRequest({ authMaterial: absentAuthMaterial() }),
    );

    expect(result).toMatchObject({
      status: "denied",
      decision: "unauthenticated",
      error: {
        code: "AUTHENTICATION_REQUIRED",
        message: GATEWAY_SAFE_MESSAGES.AUTHENTICATION_REQUIRED,
      },
    });
    expect(principalResolver.resolveCalls).toHaveLength(0);
  });

  it("11. token invalide → refus AUTH_TOKEN_INVALID", async () => {
    const { gateway } = createGatewayTestHarness();

    const result = await gateway.resolve(
      baseGatewayRequest({
        authMaterial: baseAuthMaterial({
          bearer_token: BEARER_TOKEN_INVALID,
        }),
      }),
    );

    expect(result).toMatchObject({
      status: "denied",
      decision: "invalid_token",
      error: { code: "AUTH_TOKEN_INVALID" },
    });
  });

  it("12. token expiré → refus AUTH_TOKEN_EXPIRED", async () => {
    const { gateway } = createGatewayTestHarness();

    const viaToken = await gateway.resolve(
      baseGatewayRequest({
        authMaterial: baseAuthMaterial({
          bearer_token: BEARER_TOKEN_EXPIRED,
        }),
      }),
    );
    expect(viaToken).toMatchObject({
      status: "denied",
      decision: "expired_token",
      error: { code: "AUTH_TOKEN_EXPIRED" },
    });

    const viaClock = await gateway.resolve(
      baseGatewayRequest({ now: FIXED_NOW_AFTER_EXPIRY }),
    );
    expect(viaClock).toMatchObject({
      status: "denied",
      decision: "expired_token",
      error: { code: "AUTH_TOKEN_EXPIRED" },
    });
  });

  it("13. issuer invalide → refus AUTH_ISSUER_MISMATCH", async () => {
    const { gateway } = createGatewayTestHarness();

    const result = await gateway.resolve(
      baseGatewayRequest({
        authMaterial: baseAuthMaterial({
          bearer_token: BEARER_TOKEN_ISSUER_MISMATCH,
        }),
      }),
    );

    expect(result).toMatchObject({
      status: "denied",
      decision: "issuer_mismatch",
      error: { code: "AUTH_ISSUER_MISMATCH" },
    });
  });

  it("14. audience invalide → refus AUTH_AUDIENCE_MISMATCH", async () => {
    const { gateway } = createGatewayTestHarness();

    const result = await gateway.resolve(
      baseGatewayRequest({
        authMaterial: baseAuthMaterial({
          bearer_token: BEARER_TOKEN_AUDIENCE_MISMATCH,
        }),
      }),
    );

    expect(result).toMatchObject({
      status: "denied",
      decision: "audience_mismatch",
      error: { code: "AUTH_AUDIENCE_MISMATCH" },
    });
  });

  // -------------------------------------------------------------------------
  // 15–20 · Acteur / tenant / membership
  // -------------------------------------------------------------------------

  it("15. actor dérivé du principal vérifié (pas du body)", async () => {
    const { gateway } = createGatewayTestHarness();

    const result = await gateway.resolve(baseGatewayRequest());
    expect(result.status).toBe("authenticated");
    if (result.status !== "authenticated") return;

    expect(result.context.actor_id).toBe(ACTOR_ID_A);
    expect(result.context.actor_type).toBe("human");
    expect(result.external_request).not.toHaveProperty("actor_id");
  });

  it("16. tenant dérivé d’une membership réelle", async () => {
    const { gateway, membershipResolver } = createGatewayTestHarness();

    const result = await gateway.resolve(baseGatewayRequest());
    expect(result.status).toBe("authenticated");
    if (result.status !== "authenticated") return;

    expect(result.context.tenant_id).toBe(TENANT_A_UUID);
    expect(membershipResolver.resolveCalls).toHaveLength(1);
    expect(membershipResolver.resolveCalls[0]?.principal.principal_subject).toBe(
      PRINCIPAL_SUBJECT_A,
    );
  });

  it("17. membership absente → refus TENANT_MEMBERSHIP_REQUIRED", async () => {
    const { gateway, membershipResolver } = createGatewayTestHarness();
    membershipResolver.setMemberships(PRINCIPAL_SUBJECT_A, []);

    const result = await gateway.resolve(baseGatewayRequest());

    expect(result).toMatchObject({
      status: "denied",
      decision: "tenant_membership_missing",
      error: { code: "TENANT_MEMBERSHIP_REQUIRED" },
    });
  });

  it("18. membership inactive → refus TENANT_MEMBERSHIP_INACTIVE", async () => {
    const { gateway, membershipResolver } = createGatewayTestHarness();
    membershipResolver.setMemberships(PRINCIPAL_SUBJECT_A, [
      { tenant_id: TENANT_A_UUID, roles: ["owner"], status: "inactive" },
    ]);

    const result = await gateway.resolve(baseGatewayRequest());

    expect(result).toMatchObject({
      status: "denied",
      decision: "tenant_membership_inactive",
      error: { code: "TENANT_MEMBERSHIP_INACTIVE" },
    });
  });

  it("19. actor disabled → refus ACTOR_DISABLED", async () => {
    const { gateway } = createGatewayTestHarness();

    const result = await gateway.resolve(
      baseGatewayRequest({
        authMaterial: baseAuthMaterial({
          bearer_token: BEARER_TOKEN_ACTOR_DISABLED,
        }),
      }),
    );

    expect(result).toMatchObject({
      status: "denied",
      decision: "actor_disabled",
      error: { code: "ACTOR_DISABLED" },
    });
  });

  it("20. tenant arbitraire (hint hors membership) → refus", async () => {
    const { gateway } = createGatewayTestHarness();

    const result = await gateway.resolve(
      baseGatewayRequest({
        requestMetadata: {
          request_id: REQUEST_ID,
          correlation_id: CORRELATION_ID,
          requested_tenant_id: TENANT_UNKNOWN_UUID,
        },
      }),
    );

    expect(result).toMatchObject({
      status: "denied",
      decision: "tenant_membership_missing",
    });
    expect(
      result.status === "denied" &&
        (result.error.code === "TENANT_MEMBERSHIP_REQUIRED" ||
          result.error.code === "TENANT_NOT_FOUND"),
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 21–22 · Multi-tenant
  // -------------------------------------------------------------------------

  it("21. multi-tenant + tenant autorisé → accepté", async () => {
    const { gateway, membershipResolver } = createGatewayTestHarness();
    membershipResolver.setMemberships(
      PRINCIPAL_SUBJECT_A,
      multiTenantMemberships(),
    );

    const result = await gateway.resolve(
      baseGatewayRequest({
        requestMetadata: {
          request_id: REQUEST_ID,
          requested_tenant_id: TENANT_B_UUID,
        },
      }),
    );

    expect(result.status).toBe("authenticated");
    if (result.status !== "authenticated") return;
    expect(result.context.tenant_id).toBe(TENANT_B_UUID);
    expect(result.context.roles).toEqual(["member"]);
  });

  it("22. multi-tenant + tenant non autorisé → refus", async () => {
    const { gateway, membershipResolver } = createGatewayTestHarness();
    membershipResolver.setMemberships(
      PRINCIPAL_SUBJECT_A,
      multiTenantMemberships(),
    );

    const result = await gateway.resolve(
      baseGatewayRequest({
        requestMetadata: {
          request_id: REQUEST_ID,
          requested_tenant_id: TENANT_UNKNOWN_UUID,
        },
      }),
    );

    expect(result.status).toBe("denied");
    expect(result.decision).toBe("tenant_membership_missing");
  });

  // -------------------------------------------------------------------------
  // 23–25 · Sanitization JWT / audit / claims
  // -------------------------------------------------------------------------

  it("23. JWT brut absent du TrustedExecutionContext", async () => {
    const principalResolver = createMemoryPrincipalResolver();
    principalResolver.setOutcome({
      outcome: "authenticated",
      principal: {
        principal_subject: PRINCIPAL_SUBJECT_A,
        actor_id: ACTOR_ID_A,
        actor_type: "human",
        authentication_method: "supabase_auth_jwt",
        session_id_hash: "abc",
      },
    });
    // Tentative poison : le schéma principal refuse jwt — forcer via setPrincipal
    // n'injecte pas jwt dans le contexte même si authMaterial porte le bearer.
    const membershipResolver = createMemoryMembershipResolver();
    const gateway = createRequestGateway({
      principalResolver,
      membershipResolver,
    });

    const result = await gateway.resolve(
      baseGatewayRequest({
        authMaterial: baseAuthMaterial({
          bearer_token: BEARER_TOKEN_VALID,
        }),
      }),
    );

    expect(result.status).toBe("authenticated");
    if (result.status !== "authenticated") return;
    expectNoJwtInContext(result.context);
    expect(JSON.stringify(result.context)).not.toContain(BEARER_TOKEN_VALID);
    expect(JSON.stringify(result.context)).not.toContain(SENSITIVE_RAW_JWT);
  });

  it("24. token absent de l’audit / payload de résolution", async () => {
    const { gateway } = createGatewayTestHarness();

    const result = await gateway.resolve(baseGatewayRequest());
    expect(result.status).toBe("authenticated");
    if (result.status !== "authenticated") return;

    // Contexte + métadonnées de résolution — jamais le Bearer / JWT.
    expectNoTokenInAuditPayload(result.context);
    expectNoJwtInContext(result.context);
    expect(JSON.stringify(result.context)).not.toContain(BEARER_TOKEN_VALID);
    // Enveloppe de résolution hors arguments métier.
    const { external_request: _ext, ...resolutionMeta } = result;
    void _ext;
    expectNoTokenInAuditPayload(resolutionMeta);
    expect(JSON.stringify(resolutionMeta)).not.toContain(BEARER_TOKEN_VALID);

    const denied = await gateway.resolve(
      baseGatewayRequest({
        authMaterial: baseAuthMaterial({
          bearer_token: BEARER_TOKEN_INVALID,
        }),
      }),
    );
    expectNoTokenInAuditPayload(denied);
    expectNoSensitiveLeak(denied);
    expect(JSON.stringify(denied)).not.toContain(BEARER_TOKEN_INVALID);
  });

  it("25. claims inutiles absents du contexte", async () => {
    const { gateway } = createGatewayTestHarness();

    const result = await gateway.resolve(baseGatewayRequest());
    expect(result.status).toBe("authenticated");
    if (result.status !== "authenticated") return;

    expectNoUselessClaims(result.context);
    const allowedKeys = new Set([
      "tenant_id",
      "actor_id",
      "actor_type",
      "roles",
      "authenticated_at",
      "authentication_method",
      "session_id_hash",
      "principal_subject",
      "trust_level",
      "request_id",
      "correlation_id",
      "now",
    ]);
    for (const key of Object.keys(result.context)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // 26 · Non-mutation
  // -------------------------------------------------------------------------

  it("26. input non muté", async () => {
    const { gateway } = createGatewayTestHarness();
    const request = baseGatewayRequest();
    const snapshot = structuredClone(request);

    await gateway.resolve(request);

    expect(request).toEqual(snapshot);
    expect(request.externalRequest.arguments).toEqual(
      snapshot.externalRequest.arguments,
    );
  });

  // -------------------------------------------------------------------------
  // 27–29 · Erreurs normalisées / masquées
  // -------------------------------------------------------------------------

  it("27. erreur repository/membership normalisée → unavailable", async () => {
    const { gateway, membershipResolver } = createGatewayTestHarness();
    membershipResolver.setNextOutcome("throw");
    membershipResolver.setThrowRaw(
      new Error(`relation does not exist ${RAW_AUTH_PROVIDER_DETAIL}`),
    );

    const result = await gateway.resolve(baseGatewayRequest());

    expect(result).toMatchObject({
      status: "denied",
      decision: "unavailable",
      error: {
        code: "AUTH_SERVICE_UNAVAILABLE",
        message: GATEWAY_SAFE_MESSAGES.AUTH_SERVICE_UNAVAILABLE,
      },
    });
    expectNoSensitiveLeak(result);
  });

  it("28. erreur auth brute masquée", async () => {
    const { gateway, principalResolver } = createGatewayTestHarness();
    principalResolver.setOutcome("throw");

    const result = await gateway.resolve(baseGatewayRequest());

    expect(result).toMatchObject({
      status: "denied",
      decision: "unavailable",
      error: { code: "AUTH_SERVICE_UNAVAILABLE" },
    });
    expect(JSON.stringify(result)).not.toContain(RAW_AUTH_PROVIDER_DETAIL);
    expect(JSON.stringify(result)).not.toContain(SENSITIVE_RAW_JWT);
    expectNoSensitiveLeak(result);
  });

  it("29. stack masquée", async () => {
    const { gateway, principalResolver } = createGatewayTestHarness();
    principalResolver.setOutcome("throw");

    const result = await gateway.resolve(baseGatewayRequest());

    expect(JSON.stringify(result)).not.toContain(SENSITIVE_STACK_FRAGMENT);
    expect(JSON.stringify(result)).not.toContain("at Object.resolvePrincipal");
    expect(result).not.toHaveProperty("stack");
    if (result.status === "denied") {
      expect(result.error).not.toHaveProperty("stack");
      expect(result.error).not.toHaveProperty("cause");
    }
  });

  // -------------------------------------------------------------------------
  // 30 · Déterminisme
  // -------------------------------------------------------------------------

  it("30. contexte déterministe à inputs et horloge identiques", async () => {
    const { gateway } = createGatewayTestHarness();
    const request = baseGatewayRequest();

    const a = await gateway.resolve(request);
    const b = await gateway.resolve(structuredClone(request));

    expect(a).toEqual(b);
    expect(a.status).toBe("authenticated");
    if (a.status !== "authenticated" || b.status !== "authenticated") return;
    expect(a.context).toEqual(b.context);
    expect(a.context.now).toBe(FIXED_NOW);
    expect(b.context.now).toBe(FIXED_NOW);
  });
});
