/**
 * Intentions Router + TrustedExecutionContext mémoire (G1-K).
 * Pas d’identité déclarative dans l’intention — uniquement le contexte de confiance.
 */

import type { TrustedExecutionContext } from "@/lib/agent/gateway/types";

import {
  ACTOR_ID,
  APPROVAL_ID,
  CORRELATION_ID,
  FIXED_NOW,
  INVOICE_1,
  REQUEST_ID,
  TENANT_A_UUID,
} from "./constants";

/** Contexte de confiance injecté (horloge + identité serveur). */
export function routeContext(
  overrides: Partial<TrustedExecutionContext> = {},
): TrustedExecutionContext {
  return {
    tenant_id: TENANT_A_UUID,
    actor_id: ACTOR_ID,
    actor_type: "human",
    roles: ["owner"],
    authentication_method: "supabase_auth_session",
    principal_subject: ACTOR_ID,
    trust_level: "authenticated_tenant_member",
    request_id: REQUEST_ID,
    correlation_id: CORRELATION_ID,
    now: FIXED_NOW,
    authenticated_at: FIXED_NOW,
    ...overrides,
  };
}

/**
 * Intention métier ValidatedToolIntent (G1-K).
 * Typée en Record pour permettre les poisons (prompt_says_allowed, grants, …).
 */
export type FixtureRouteRequest = {
  tool_id: string;
  tool_version: string;
  mode: "agir" | "conseiller" | "transmettre";
  requested_autonomy_level: 0 | 1 | 2 | 3;
  resource?: {
    kind: string;
    resource_id: string;
  };
  approval_id?: string;
  arguments: unknown;
  correlation_id: string;
  idempotency_key?: string;
};

export function baseReadRouteRequest(
  overrides: Partial<FixtureRouteRequest> = {},
): FixtureRouteRequest {
  return {
    tool_id: "invoice.get",
    tool_version: "1.0.0",
    mode: "agir",
    requested_autonomy_level: 1,
    resource: {
      kind: "invoice",
      resource_id: INVOICE_1,
    },
    arguments: {
      invoice_id: INVOICE_1,
    },
    correlation_id: CORRELATION_ID,
    ...overrides,
  };
}

export function baseWriteRouteRequest(
  overrides: Partial<FixtureRouteRequest> = {},
): FixtureRouteRequest {
  return {
    tool_id: "payment.create_attempt",
    tool_version: "1.0.0",
    mode: "agir",
    requested_autonomy_level: 2,
    resource: {
      kind: "invoice",
      resource_id: INVOICE_1,
    },
    arguments: {
      invoice_id: INVOICE_1,
      amount_cents: 12_000,
      currency: "EUR",
    },
    correlation_id: CORRELATION_ID,
    ...overrides,
  };
}

/** Write avec approval_id — chemin G1-H (inspect → consume). */
export function baseWriteRouteRequestWithApproval(
  overrides: Partial<FixtureRouteRequest> = {},
): FixtureRouteRequest {
  return baseWriteRouteRequest({
    approval_id: APPROVAL_ID,
    ...overrides,
  });
}
