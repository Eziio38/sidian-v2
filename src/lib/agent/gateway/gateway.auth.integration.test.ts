/**
 * Tests d’intégration G1-K — auth réelle Supabase locale + adapters + gateway.
 *
 * Prérequis : stack locale up (`supabase start`), migrations appliquées.
 * Lancer via le script fail-closed :
 *   node scripts/test-g1-k-agent-gateway-auth.mjs
 *
 * Couverture 31–42 (brief G1-K).
 */

import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createBearerScopedSupabaseClient,
  createRequestGateway,
  createSupabaseAuthPrincipalResolver,
  createSupabaseTenantMembershipResolver,
} from "./test-fixtures/integration-adapters";
import {
  CORRELATION_ID,
  FIXED_NOW,
  REQUEST_ID,
  baseExternalRequest,
} from "./test-fixtures";

const SUPABASE_URL =
  process.env.SIDIAN_TEST_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const LOCAL_DEMO_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

/** Forcé par le script mjs fail-closed — sinon skip si auth locale absente. */
const REQUIRE_AUTH = process.env.SIDIAN_G1K_REQUIRE_AUTH === "1";

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
    "Fail-closed G1-K : SIDIAN_G1K_REQUIRE_AUTH=1 mais auth locale absente.",
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
  const password = "G1K-Gateway-Local-Password1!";
  const email = `g1k-${label}-${Date.now()}-${randomUUID()}@sidian.test`;

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
      nom: `Agence G1K ${label}`,
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

function createGatewayForToken(accessToken: string) {
  const supabase = createBearerScopedSupabaseClient({
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    accessToken,
  });
  return createRequestGateway({
    principalResolver: createSupabaseAuthPrincipalResolver({
      supabase,
      supabaseUrl: SUPABASE_URL,
    }),
    membershipResolver: createSupabaseTenantMembershipResolver({
      supabase,
    }),
  });
}

function gatewayRequest(
  accessToken: string | undefined,
  overrides: {
    requested_tenant_id?: string;
    credential_present?: boolean;
    bearer_token?: string;
    now?: string;
  } = {},
) {
  const bearer = overrides.bearer_token ?? accessToken;
  const credentialPresent =
    overrides.credential_present ?? Boolean(bearer);

  return {
    externalRequest: baseExternalRequest({
      arguments: { invoice_id: "inv_g1k_int" },
    }),
    authMaterial: {
      credential_present: credentialPresent,
      ...(credentialPresent && bearer ? { bearer_token: bearer } : {}),
    },
    requestMetadata: {
      request_id: REQUEST_ID,
      correlation_id: CORRELATION_ID,
      ...(overrides.requested_tenant_id !== undefined
        ? { requested_tenant_id: overrides.requested_tenant_id }
        : {}),
    },
    // Horloge proche de « maintenant » pour ne pas expirer les JWT locaux.
    now: overrides.now ?? new Date().toISOString(),
  };
}

describe.skipIf(!authAvailable)(
  "G1-K gateway auth integration (Supabase local)",
  () => {
    let tenantA: TenantFixture;
    let tenantB: TenantFixture;
    let userNoMembership: TenantFixture;
    let inactiveTenant: TenantFixture;
    let bannedTenant: TenantFixture;

    beforeAll(async () => {
      tenantA = await createTenant("a");
      tenantB = await createTenant("b");

      const admin = adminClient();
      const password = "G1K-Gateway-Local-Password1!";
      const email = `g1k-nomem-${Date.now()}-${randomUUID()}@sidian.test`;
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

      bannedTenant = await createTenant("banned");
      const banned = await admin.auth.admin.updateUserById(
        bannedTenant.userId,
        { ban_duration: "24h" },
      );
      if (banned.error) {
        throw banned.error;
      }
    }, 120_000);

    afterAll(async () => {
      const admin = adminClient();
      for (const fixture of [
        tenantA,
        tenantB,
        userNoMembership,
        inactiveTenant,
        bannedTenant,
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

    it("31. session Supabase valide résolue", async () => {
      const gateway = createGatewayForToken(tenantA.accessToken);
      const result = await gateway.resolve(
        gatewayRequest(tenantA.accessToken),
      );

      expect(result.status).toBe("authenticated");
      if (result.status !== "authenticated") return;
      expect(result.context.tenant_id).toBe(tenantA.prestataireId);
      expect(result.context.actor_id).toBe(tenantA.userId);
      expect(result.context.principal_subject).toBe(tenantA.userId);
      expect(JSON.stringify(result.context)).not.toContain(
        tenantA.accessToken,
      );
    });

    it("32. session invalide refusée", async () => {
      const gateway = createGatewayForToken(tenantA.accessToken);
      const result = await gateway.resolve(
        gatewayRequest(undefined, {
          credential_present: true,
          bearer_token: "not.a.valid.jwt",
        }),
      );

      expect(result.status).toBe("denied");
      expect(result.decision).toBe("invalid_token");
    });

    it("33. utilisateur tenant A ne peut construire un contexte tenant B", async () => {
      const gateway = createGatewayForToken(tenantA.accessToken);
      const result = await gateway.resolve(
        gatewayRequest(tenantA.accessToken, {
          requested_tenant_id: tenantB.prestataireId,
        }),
      );

      expect(result.status).toBe("denied");
      if (result.status !== "denied") return;
      expect(
        result.decision === "tenant_membership_missing" ||
          result.error.code === "TENANT_NOT_FOUND",
      ).toBe(true);
    });

    it("34. utilisateur tenant A peut construire son contexte tenant A", async () => {
      const gateway = createGatewayForToken(tenantA.accessToken);
      const result = await gateway.resolve(
        gatewayRequest(tenantA.accessToken, {
          requested_tenant_id: tenantA.prestataireId,
        }),
      );

      expect(result.status).toBe("authenticated");
      if (result.status !== "authenticated") return;
      expect(result.context.tenant_id).toBe(tenantA.prestataireId);
    });

    it("35. utilisateur sans membership refusé", async () => {
      const gateway = createGatewayForToken(userNoMembership.accessToken);
      const result = await gateway.resolve(
        gatewayRequest(userNoMembership.accessToken),
      );

      expect(result.status).toBe("denied");
      expect(result.decision).toBe("tenant_membership_missing");
    });

    it("36. membership désactivée refusée", async () => {
      const gateway = createGatewayForToken(inactiveTenant.accessToken);
      const result = await gateway.resolve(
        gatewayRequest(inactiveTenant.accessToken),
      );

      expect(result.status).toBe("denied");
      expect(result.decision).toBe("tenant_membership_inactive");
    });

    it("37. actor désactivé refusé si modèle disponible", async () => {
      const gateway = createGatewayForToken(bannedTenant.accessToken);
      const result = await gateway.resolve(
        gatewayRequest(bannedTenant.accessToken),
      );

      expect(result.status).toBe("denied");
      if (result.status !== "denied") return;
      expect(
        result.decision === "actor_disabled" ||
          result.decision === "invalid_token" ||
          result.decision === "unauthenticated",
      ).toBe(true);
    });

    it("38. requête anon refusée", async () => {
      const gateway = createGatewayForToken(tenantA.accessToken);
      const result = await gateway.resolve(
        gatewayRequest(undefined, { credential_present: false }),
      );

      expect(result).toMatchObject({
        status: "denied",
        decision: "unauthenticated",
        error: { code: "AUTHENTICATION_REQUIRED" },
      });
    });

    it("39. tenant vérifié propagé aux opérations RLS", async () => {
      const gateway = createGatewayForToken(tenantA.accessToken);
      const result = await gateway.resolve(
        gatewayRequest(tenantA.accessToken),
      );
      expect(result.status).toBe("authenticated");
      if (result.status !== "authenticated") return;

      const userClient = anonClient(tenantA.accessToken);
      const { data, error } = await userClient.rpc("current_prestataire_id");
      expect(error).toBeNull();
      expect(data).toBe(result.context.tenant_id);
      expect(data).toBe(tenantA.prestataireId);
    });

    it("40. aucun accès cross-tenant via repository (RLS audit)", async () => {
      const admin = adminClient();
      const auditIdA = `aud_g1k_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
      const auditIdB = `aud_g1k_${randomUUID().replaceAll("-", "").slice(0, 20)}`;

      const insert = async (tenantId: string, auditId: string) => {
        const { error } = await admin.from("agent_audit_events").insert({
          audit_id: auditId,
          schema_version: "1",
          occurred_at: FIXED_NOW,
          correlation_id: `corr_${auditId}`,
          tenant_id: tenantId,
          actor_id: "actor_g1k",
          actor_type: "human",
          tool_id: "invoice.get",
          tool_version: "1.0.0",
          mode: "agir",
          requested_autonomy_level: 1,
          decision: "allow",
          result_status: "success",
          reason_code: "SUCCESS",
          resource_kind: "invoice",
          resource_id: "inv_g1k",
          params_hash: "h".repeat(64),
          output_hash: "o".repeat(64),
          executor_id: "exec_g1k",
          event_payload: {
            audit_id: auditId,
            timestamp: FIXED_NOW,
            correlation_id: `corr_${auditId}`,
            tenant: { tenant_id: tenantId },
            actor: { actor_id: "actor_g1k", actor_type: "human" },
            tool: { tool_id: "invoice.get", tool_version: "1.0.0" },
            mode: "agir",
            autonomy: { requested: 1, maximum: 1 },
            decision: "allow",
            result: "success",
            reason_code: "SUCCESS",
            duration_ms: 1,
            params_hash: "h".repeat(64),
            executor: "exec_g1k",
            output_hash: "o".repeat(64),
          },
        });
        if (error) throw error;
      };

      await insert(tenantA.prestataireId, auditIdA);
      await insert(tenantB.prestataireId, auditIdB);

      const clientA = anonClient(tenantA.accessToken);
      const readOwn = await clientA
        .from("agent_audit_events")
        .select("audit_id")
        .eq("audit_id", auditIdA);
      expect(readOwn.error).toBeNull();
      expect(readOwn.data?.length).toBe(1);

      const readCross = await clientA
        .from("agent_audit_events")
        .select("audit_id")
        .eq("audit_id", auditIdB);
      expect(readCross.data?.length ?? 0).toBe(0);
    });

    it("41. aucune élévation via service role (JWT technique refusé)", async () => {
      const gateway = createGatewayForToken(LOCAL_DEMO_SERVICE_ROLE_KEY);
      const result = await gateway.resolve(
        gatewayRequest(undefined, {
          credential_present: true,
          bearer_token: LOCAL_DEMO_SERVICE_ROLE_KEY,
        }),
      );

      expect(result.status).toBe("denied");
      if (result.status !== "denied") return;
      expect(
        result.decision === "invalid_token" ||
          result.decision === "unauthenticated" ||
          result.decision === "unavailable",
      ).toBe(true);
    });

    it("42. aucune confiance dans un claim client non vérifié", async () => {
      const gateway = createGatewayForToken(tenantA.accessToken);

      const poisonedBody = await gateway.resolve({
        ...gatewayRequest(tenantA.accessToken),
        externalRequest: {
          ...baseExternalRequest({ arguments: {} }),
          tenant_id: tenantB.prestataireId,
          actor_id: tenantB.userId,
          roles: ["owner", "admin"],
        } as never,
      });
      expect(poisonedBody.status).toBe("invalid");
      if (poisonedBody.status === "invalid") {
        expect(poisonedBody.error.code).toBe("GATEWAY_INPUT_INVALID");
      }

      const poisonedHint = await gateway.resolve(
        gatewayRequest(tenantA.accessToken, {
          requested_tenant_id: tenantB.prestataireId,
        }),
      );
      expect(poisonedHint.status).toBe("denied");
    });
  },
);
