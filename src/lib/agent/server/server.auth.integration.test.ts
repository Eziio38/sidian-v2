/**
 * Tests d’intégration G1-L — Server Entry Point + auth Supabase locale.
 *
 * Prérequis : stack locale up (`supabase start`), migrations appliquées.
 * Lancer via le script fail-closed :
 *   node scripts/test-g1-l-agent-server-auth.mjs
 *
 * Couverture 46–56 (brief G1-L).
 */

import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { TrustedExecutionContext } from "@/lib/agent/gateway";
import {
  createRouterTestHarness,
  createWriteRouterTestHarness,
} from "@/lib/agent/router/test-fixtures";

import {
  CORRELATION_ID,
  FIXED_NOW,
  REQUEST_ID,
  createAgentHttpRequest,
  createAgentServerHandler,
  createBearerScopedSupabaseClient,
  createRequestGateway,
  createServerRequestAuthAdapter,
  createSpyRouter,
  createSupabaseAuthPrincipalResolver,
  createSupabaseTenantMembershipResolver,
  expectErrorResponse,
  expectNoSensitiveHttpLeak,
  nominalExternalBody,
  readJsonBody,
} from "./test-fixtures";

const SUPABASE_URL =
  process.env.SIDIAN_TEST_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const LOCAL_DEMO_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

/** Forcé par le script mjs fail-closed — sinon skip si auth locale absente. */
const REQUIRE_AUTH = process.env.SIDIAN_G1L_REQUIRE_AUTH === "1";

type TenantFixture = {
  email: string;
  password: string;
  userId: string;
  prestataireId: string;
  accessToken: string;
};

async function probeLocalAuth(): Promise<boolean> {
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: ANON_KEY },
      signal: AbortSignal.timeout(3_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const authAvailable = await probeLocalAuth();
if (REQUIRE_AUTH && !authAvailable) {
  throw new Error(
    "Fail-closed G1-L : SIDIAN_G1L_REQUIRE_AUTH=1 mais auth locale absente.",
  );
}

function adminClient() {
  return createClient(SUPABASE_URL, LOCAL_DEMO_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function anonClient(accessToken?: string) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(accessToken
      ? {
          global: {
            headers: { Authorization: `Bearer ${accessToken}` },
          },
        }
      : {}),
  });
}

async function createTenant(label: string): Promise<TenantFixture> {
  const admin = adminClient();
  const password = "G1L-Server-Local-Password1!";
  const email = `g1l-${label}-${Date.now()}-${randomUUID()}@sidian.test`;

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error("auth_user_creation_failed");
  }

  const prestataire = await admin
    .from("prestataire")
    .insert({
      user_id: created.data.user.id,
      nom: `Agence G1L ${label}`,
      email,
    })
    .select("id")
    .single();
  if (prestataire.error || !prestataire.data) {
    throw prestataire.error ?? new Error("prestataire_creation_failed");
  }

  const signedIn = await anonClient().auth.signInWithPassword({
    email,
    password,
  });
  if (signedIn.error || !signedIn.data.session) {
    throw signedIn.error ?? new Error("auth_sign_in_failed");
  }

  return {
    email,
    password,
    userId: created.data.user.id,
    prestataireId: prestataire.data.id as string,
    accessToken: signedIn.data.session.access_token,
  };
}

function createHandlerForToken(
  accessToken: string | undefined,
  options: {
    writeTool?: boolean;
    withIdempotency?: boolean;
    withApproval?: boolean;
  } = {},
) {
  const bearer = accessToken ?? "missing.token";
  const supabase = createBearerScopedSupabaseClient({
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    accessToken: bearer,
  });
  const gateway = createRequestGateway({
    principalResolver: createSupabaseAuthPrincipalResolver({
      supabase,
      supabaseUrl: SUPABASE_URL,
    }),
    membershipResolver: createSupabaseTenantMembershipResolver({
      supabase,
    }),
  });

  const routerHarness = options.writeTool
    ? createWriteRouterTestHarness({
        permissionMode: "allow",
        withAuditSink: true,
        withIdempotency: options.withIdempotency ?? true,
        withApproval: options.withApproval ?? true,
        withObservability: true,
      })
    : createRouterTestHarness({
        permissionMode: "allow",
        withAuditSink: true,
        withIdempotency: options.withIdempotency ?? true,
        withObservability: true,
      });

  const router = createSpyRouter(routerHarness.router);
  const handler = createAgentServerHandler({
    gateway,
    router,
    authAdapter: createServerRequestAuthAdapter(),
    requestIdFactory: () => REQUEST_ID,
    clock: { now: () => new Date().toISOString() },
  });

  return { handler, router, routerHarness };
}

describe.skipIf(!authAvailable)(
  "G1-L server entry auth integration (Supabase local)",
  () => {
    let tenantA: TenantFixture;
    let tenantB: TenantFixture;
    let userNoMembership: TenantFixture;
    let inactiveTenant: TenantFixture;

    beforeAll(async () => {
      tenantA = await createTenant("a");
      tenantB = await createTenant("b");

      const admin = adminClient();
      const password = "G1L-Server-Local-Password1!";
      const email = `g1l-nomem-${Date.now()}-${randomUUID()}@sidian.test`;
      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (created.error || !created.data.user) {
        throw created.error ?? new Error("nomem_user_failed");
      }
      const signedIn = await anonClient().auth.signInWithPassword({
        email,
        password,
      });
      if (signedIn.error || !signedIn.data.session) {
        throw signedIn.error ?? new Error("nomem_sign_in_failed");
      }
      userNoMembership = {
        email,
        password,
        userId: created.data.user.id,
        prestataireId: "00000000-0000-4000-8000-000000000000",
        accessToken: signedIn.data.session.access_token,
      };

      inactiveTenant = await createTenant("inactive");
      const cancel = await admin
        .from("prestataire")
        .update({ subscription_status: "cancelled" })
        .eq("id", inactiveTenant.prestataireId)
        .select("id")
        .single();
      if (cancel.error) {
        throw cancel.error;
      }
    }, 120_000);

    afterAll(async () => {
      const admin = adminClient();
      for (const fixture of [
        tenantA,
        tenantB,
        userNoMembership,
        inactiveTenant,
      ]) {
        if (!fixture) continue;
        try {
          if (
            fixture.prestataireId !==
            "00000000-0000-4000-8000-000000000000"
          ) {
            await admin
              .from("prestataire")
              .delete()
              .eq("id", fixture.prestataireId);
          }
          await admin.auth.admin.deleteUser(fixture.userId);
        } catch {
          // best-effort cleanup
        }
      }
    });

    it("46. utilisateur tenant A → tenant A accepté", async () => {
      const { handler, router } = createHandlerForToken(tenantA.accessToken);

      const response = await handler(
        createAgentHttpRequest({
          bearer: tenantA.accessToken,
          tenantHint: tenantA.prestataireId,
          body: nominalExternalBody({
            correlation_id: CORRELATION_ID,
            arguments: { invoice_id: "inv_g1l_int" },
          }),
        }),
      );

      expect(response.status).toBe(200);
      const body = await readJsonBody(response);
      expect(body.status).toBe("success");
      expect(router.callCount()).toBe(1);
      const ctx = router.routeCalls[0]!.context as TrustedExecutionContext;
      expect(ctx.tenant_id).toBe(tenantA.prestataireId);
      expect(ctx.actor_id).toBe(tenantA.userId);
      expectNoSensitiveHttpLeak(body);
      expect(JSON.stringify(body)).not.toContain(tenantA.accessToken);
    });

    it("47. utilisateur tenant A → tenant B refusé", async () => {
      const { handler, router } = createHandlerForToken(tenantA.accessToken);

      const response = await handler(
        createAgentHttpRequest({
          bearer: tenantA.accessToken,
          tenantHint: tenantB.prestataireId,
        }),
      );

      await expectErrorResponse(response, {
        httpStatus: 403,
        code: "TENANT_ACCESS_DENIED",
      });
      expect(router.callCount()).toBe(0);
    });

    it("48. utilisateur sans membership refusé", async () => {
      const { handler, router } = createHandlerForToken(
        userNoMembership.accessToken,
      );

      const response = await handler(
        createAgentHttpRequest({ bearer: userNoMembership.accessToken }),
      );

      await expectErrorResponse(response, {
        httpStatus: 403,
        code: "TENANT_ACCESS_DENIED",
      });
      expect(router.callCount()).toBe(0);
    });

    it("49. membership désactivée refusée", async () => {
      const { handler, router } = createHandlerForToken(
        inactiveTenant.accessToken,
      );

      const response = await handler(
        createAgentHttpRequest({ bearer: inactiveTenant.accessToken }),
      );

      await expectErrorResponse(response, {
        httpStatus: 403,
        code: "TENANT_ACCESS_DENIED",
      });
      expect(router.callCount()).toBe(0);
    });

    it("50. requête anonyme refusée", async () => {
      const { handler, router } = createHandlerForToken(undefined);

      const response = await handler(
        createAgentHttpRequest({ bearer: null }),
      );

      await expectErrorResponse(response, {
        httpStatus: 401,
        code: "AUTHENTICATION_REQUIRED",
      });
      expect(router.callCount()).toBe(0);
    });

    it("51. session réellement vérifiée (JWT invalide)", async () => {
      const { handler, router } = createHandlerForToken(tenantA.accessToken);

      const response = await handler(
        createAgentHttpRequest({
          bearer: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.sig",
        }),
      );

      await expectErrorResponse(response, {
        httpStatus: 401,
        code: "AUTHENTICATION_INVALID",
      });
      expect(router.callCount()).toBe(0);
    });

    it("52. RPC sensible impossible avec un tenant arbitraire", async () => {
      const { handler, router } = createHandlerForToken(tenantA.accessToken);
      const response = await handler(
        createAgentHttpRequest({
          bearer: tenantA.accessToken,
          tenantHint: tenantA.prestataireId,
        }),
      );
      expect(response.status).toBe(200);
      const ctx = router.routeCalls[0]!.context as TrustedExecutionContext;

      const userClient = anonClient(tenantA.accessToken);
      const { data: ownId, error: ownErr } = await userClient.rpc(
        "current_prestataire_id",
      );
      expect(ownErr).toBeNull();
      expect(ownId).toBe(ctx.tenant_id);
      expect(ownId).toBe(tenantA.prestataireId);

      // Claim idempotency avec tenant B depuis session A — impossible d’élever.
      const poisonKey = `g1l_poison_${randomUUID()}`;
      const poisoned = await userClient.rpc("claim_idempotency_key", {
        p_tenant_id: tenantB.prestataireId,
        p_idempotency_key: poisonKey,
        p_request_fingerprint: "f".repeat(64),
        p_correlation_id: CORRELATION_ID,
        p_tool_id: "invoice.get",
        p_tool_version: "1.0.0",
        p_resource_kind: "invoice",
        p_resource_id: "inv_poison",
        p_mode: "agir",
        p_owner_token_hash: "a".repeat(64),
        p_ttl_seconds: 60,
      });
      // Authenticated n’a pas EXECUTE sur la RPC (service_role only) → erreur ;
      // ou décision non-acquired. Jamais d’écriture tenant B pour l’acteur A.
      if (!poisoned.error) {
        const decision = (poisoned.data as { decision?: string } | null)
          ?.decision;
        expect(decision).not.toBe("acquired");
      } else {
        expect(poisoned.error).toBeTruthy();
      }

      const admin = adminClient();
      const cross = await admin
        .from("agent_idempotency_records")
        .select("tenant_id")
        .eq("tenant_id", tenantB.prestataireId)
        .eq("idempotency_key", poisonKey)
        .limit(5);
      expect((cross.data ?? []).length).toBe(0);
    });

    it("53. service role ne permet pas de contourner le handler", async () => {
      const { handler, router } = createHandlerForToken(
        LOCAL_DEMO_SERVICE_ROLE_KEY,
      );

      const response = await handler(
        createAgentHttpRequest({
          bearer: LOCAL_DEMO_SERVICE_ROLE_KEY,
        }),
      );

      expect([401, 403, 503]).toContain(response.status);
      const body = await readJsonBody(response);
      expect(body.status).toBe("error");
      expect(router.callCount()).toBe(0);
      expectNoSensitiveHttpLeak(body);
      expect(JSON.stringify(body)).not.toContain(LOCAL_DEMO_SERVICE_ROLE_KEY);
    });

    it("54. audit stocke le tenant vérifié", async () => {
      const { handler, router, routerHarness } = createHandlerForToken(
        tenantA.accessToken,
      );

      const response = await handler(
        createAgentHttpRequest({
          bearer: tenantA.accessToken,
          tenantHint: tenantA.prestataireId,
        }),
      );
      expect(response.status).toBe(200);
      const ctx = router.routeCalls[0]!.context as TrustedExecutionContext;
      expect(ctx.tenant_id).toBe(tenantA.prestataireId);

      expect(routerHarness.auditSink).not.toBeNull();
      expect(routerHarness.auditSink!.appendCount()).toBeGreaterThanOrEqual(1);
      const audit = routerHarness.auditSink!.events[0]!;
      expect(audit.tenant.tenant_id).toBe(tenantA.prestataireId);
      expect(audit.tenant.tenant_id).not.toBe(tenantB.prestataireId);
      expect(JSON.stringify(audit)).not.toContain(tenantA.accessToken);
    });

    it("55. idempotence utilise le tenant vérifié", async () => {
      const { handler, router, routerHarness } = createHandlerForToken(
        tenantA.accessToken,
        { withIdempotency: true },
      );
      const idemKey = `g1l_idem_${randomUUID()}`;

      const response = await handler(
        createAgentHttpRequest({
          bearer: tenantA.accessToken,
          tenantHint: tenantA.prestataireId,
          body: nominalExternalBody({
            idempotency_key: idemKey,
            arguments: { invoice_id: "inv_g1l_idem" },
          }),
        }),
      );
      expect(response.status).toBe(200);
      const ctx = router.routeCalls[0]!.context as TrustedExecutionContext;
      expect(ctx.tenant_id).toBe(tenantA.prestataireId);

      expect(routerHarness.idempotencyService).not.toBeNull();
      expect(
        routerHarness.idempotencyService!.claimCount(),
      ).toBeGreaterThanOrEqual(1);
      const claim = routerHarness.idempotencyService!.claimCalls[0]!;
      expect(claim.tenant_id).toBe(tenantA.prestataireId);
      expect(claim.tenant_id).not.toBe(tenantB.prestataireId);
      void FIXED_NOW;
    });

    it("56. approval utilise le tenant vérifié", async () => {
      const { handler, router, routerHarness } = createHandlerForToken(
        tenantA.accessToken,
        { writeTool: true, withApproval: true, withIdempotency: true },
      );

      // Write sans approval_id → APPROVAL_REQUIRED, inspect/request scopés tenant.
      const response = await handler(
        createAgentHttpRequest({
          bearer: tenantA.accessToken,
          tenantHint: tenantA.prestataireId,
          body: {
            tool_id: "payment.create_attempt",
            tool_version: "1.0.0",
            mode: "agir",
            requested_autonomy_level: 2,
            arguments: {
              invoice_id: "inv_g1l_pay",
              amount_cents: 1000,
              currency: "EUR",
            },
            correlation_id: CORRELATION_ID,
          },
        }),
      );

      expect(router.callCount()).toBe(1);
      const ctx = router.routeCalls[0]!.context as TrustedExecutionContext;
      expect(ctx.tenant_id).toBe(tenantA.prestataireId);

      const body = await readJsonBody(response);
      expect(body.code).toBe("APPROVAL_REQUIRED");
      expect([202, 403]).toContain(response.status);
      expectNoSensitiveHttpLeak(body);

      // Si le service approval a été interrogé, le tenant doit être le vérifié.
      if (
        routerHarness.approvalService &&
        routerHarness.approvalService.inspectCount() > 0
      ) {
        const inspect = routerHarness.approvalService.inspectCalls[0]!;
        expect(inspect.tenant_id).toBe(tenantA.prestataireId);
      }
      if (
        routerHarness.approvalService &&
        routerHarness.approvalService.requestCalls.length > 0
      ) {
        const req = routerHarness.approvalService.requestCalls[0]!;
        expect(req.tenant_id).toBe(tenantA.prestataireId);
        expect(req.tenant_id).not.toBe(tenantB.prestataireId);
      }
    });
  },
);
