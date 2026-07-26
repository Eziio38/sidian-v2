/**
 * Inputs G1-K — requêtes gateway / external tool (fixtures).
 */

import type {
  AuthMaterial,
  ExternalToolRequest,
  GatewayRequest,
  GatewayRequestMetadata,
} from "@/lib/agent/gateway";

import {
  APPROVAL_ID,
  BEARER_TOKEN_VALID,
  CORRELATION_ID,
  FIXED_NOW,
  FULL_ARGUMENTS_PAYLOAD,
  REQUEST_ID,
  SESSION_ID_HASH,
  TENANT_A_UUID,
} from "./constants";

export function baseExternalRequest(
  overrides: Partial<ExternalToolRequest> = {},
): ExternalToolRequest {
  return {
    tool_id: "invoice.get",
    tool_version: "1.0.0",
    mode: "agir",
    requested_autonomy_level: 1,
    arguments: { ...FULL_ARGUMENTS_PAYLOAD },
    resource: {
      kind: "invoice",
      resource_id: "inv_g1k_001",
    },
    idempotency_key: "idem_g1k_1",
    approval_id: APPROVAL_ID,
    correlation_id: CORRELATION_ID,
    ...overrides,
  };
}

export function baseAuthMaterial(
  overrides: Partial<AuthMaterial> = {},
): AuthMaterial {
  return {
    credential_present: true,
    bearer_token: BEARER_TOKEN_VALID,
    session_id_hash: SESSION_ID_HASH,
    ...overrides,
  };
}

export function absentAuthMaterial(): AuthMaterial {
  return { credential_present: false };
}

export function baseRequestMetadata(
  overrides: Partial<GatewayRequestMetadata> = {},
): GatewayRequestMetadata {
  return {
    request_id: REQUEST_ID,
    correlation_id: CORRELATION_ID,
    ...overrides,
  };
}

export function baseGatewayRequest(
  overrides: {
    externalRequest?: Partial<ExternalToolRequest>;
    authMaterial?: Partial<AuthMaterial> | AuthMaterial;
    requestMetadata?: Partial<GatewayRequestMetadata>;
    now?: string;
  } = {},
): GatewayRequest {
  return {
    externalRequest: baseExternalRequest(overrides.externalRequest),
    authMaterial:
      overrides.authMaterial && "credential_present" in overrides.authMaterial
        ? (overrides.authMaterial as AuthMaterial)
        : baseAuthMaterial(overrides.authMaterial),
    requestMetadata: baseRequestMetadata(overrides.requestMetadata),
    now: overrides.now ?? FIXED_NOW,
  };
}

/** Poison — champs de confiance injectés dans le body externe. */
export function externalWithForbiddenField(
  field: string,
  value: unknown = TENANT_A_UUID,
): Record<string, unknown> {
  return {
    ...baseExternalRequest(),
    [field]: value,
  };
}
