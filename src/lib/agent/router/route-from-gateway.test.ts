/**
 * Tests G1-K — toTrustedRouteInput + routeFromGateway.
 */

import { describe, expect, it } from "vitest";

import {
  createRequestGateway,
  toTrustedRouteInput,
} from "@/lib/agent/gateway";
import { routeFromGateway } from "@/lib/agent/router";

import {
  createMemoryPrincipalResolver,
  createMemoryMembershipResolver,
  baseGatewayRequest,
  FIXED_NOW,
  TENANT_A_UUID,
  ACTOR_ID_A,
  BEARER_TOKEN_VALID,
} from "@/lib/agent/gateway/test-fixtures";
import { createRouterTestHarness } from "./test-fixtures";

describe("toTrustedRouteInput / routeFromGateway (G1-K)", () => {
  it("assemble intention sans identité + contexte trusted", async () => {
    const gateway = createRequestGateway({
      principalResolver: createMemoryPrincipalResolver(),
      membershipResolver: createMemoryMembershipResolver(),
    });
    const resolution = await gateway.resolve(
      baseGatewayRequest({
        authMaterial: {
          credential_present: true,
          bearer_token: BEARER_TOKEN_VALID,
        },
        now: FIXED_NOW,
      }),
    );
    expect(resolution.status).toBe("authenticated");
    if (resolution.status !== "authenticated") return;

    const input = toTrustedRouteInput(resolution);
    expect(input.context.tenant_id).toBe(TENANT_A_UUID);
    expect(input.context.actor_id).toBe(ACTOR_ID_A);
    expect(input.request).not.toHaveProperty("tenant_id");
    expect(input.request).not.toHaveProperty("actor_id");
    expect(input.request).not.toHaveProperty("grants");
    expect(input.request.tool_id).toBe(resolution.external_request.tool_id);
  });

  it("routeFromGateway refuse de router si denied", async () => {
    const harness = createRouterTestHarness();
    const out = await routeFromGateway(
      {
        status: "denied",
        decision: "unauthenticated",
        error: {
          code: "AUTHENTICATION_REQUIRED",
          category: "authentication",
          message: "Authentification requise.",
        },
      },
      {
        registry: harness.registry,
        permissionService: harness.permissionService,
        executorResolver: harness.executorResolver,
      },
    );
    expect(out.status).toBe("gateway_denied");
    expect(harness.executor.callCount()).toBe(0);
  });

  it("routeFromGateway route si authenticated", async () => {
    const gateway = createRequestGateway({
      principalResolver: createMemoryPrincipalResolver(),
      membershipResolver: createMemoryMembershipResolver(),
    });
    const gatewayRequest = baseGatewayRequest({
      externalRequest: {
        tool_id: "invoice.get",
        tool_version: "1.0.0",
        mode: "agir",
        requested_autonomy_level: 1,
        arguments: { invoice_id: "inv_001" },
        resource: { kind: "invoice", resource_id: "inv_001" },
        correlation_id: "corr_g1k_route",
      },
      authMaterial: {
        credential_present: true,
        bearer_token: BEARER_TOKEN_VALID,
      },
      now: FIXED_NOW,
    });
    // Retirer approval/idempotence optionnels (defaults fixtures) pour lecture sans G/H.
    delete gatewayRequest.externalRequest.approval_id;
    delete gatewayRequest.externalRequest.idempotency_key;

    const resolution = await gateway.resolve(gatewayRequest);
    expect(resolution.status).toBe("authenticated");
    if (resolution.status !== "authenticated") return;

    const harness = createRouterTestHarness();
    const out = await routeFromGateway(resolution, {
      registry: harness.registry,
      permissionService: harness.permissionService,
      executorResolver: harness.executorResolver,
      auditService: harness.auditService,
      ...(harness.auditSink ? { auditSink: harness.auditSink } : {}),
    });
    expect(out.status).toBe("routed");
    if (out.status === "routed") {
      expect(out.result.status).toBe("success");
      expect(out.result.audit?.tenant.tenant_id).toBe(TENANT_A_UUID);
      expect(out.result.audit?.actor.actor_id).toBe(ACTOR_ID_A);
    }
  });
});
