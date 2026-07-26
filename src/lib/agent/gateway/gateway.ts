/**
 * Request Gateway — frontière de confiance (G1-K).
 *
 * Transforme une requête externe non fiable + matériel auth adapter
 * en TrustedExecutionContext vérifié, ou en refus fail-closed.
 *
 * Aucune I/O concrète : principal / membership via resolvers injectés
 * (implémentations dans `adapters/`, tâche C).
 * Horloge : `request.now` uniquement — jamais Date.now().
 */

import {
  GatewayError,
  gatewayErrorDescriptor,
  gatewayErrorFromDecision,
  type GatewayDenialDecision,
} from "./errors";
import {
  isPrincipalExpired,
  sanitizeAuthenticatedPrincipal,
} from "./principal";
import { gatewayRequestSchema } from "./schemas";
import { buildTrustedExecutionContext } from "./trusted-context";
import type {
  ExternalToolRequest,
  GatewayResolution,
  GatewayResolutionDenied,
  GatewayResolutionInvalid,
  RequestGateway,
  RequestGatewayDependencies,
  ResolveMembershipResult,
  ResolvePrincipalResult,
} from "./types";

function copyExternalRequest(
  request: ExternalToolRequest,
): ExternalToolRequest {
  return {
    tool_id: request.tool_id,
    tool_version: request.tool_version,
    mode: request.mode,
    requested_autonomy_level: request.requested_autonomy_level,
    arguments: request.arguments,
    ...(request.resource !== undefined
      ? {
          resource: {
            kind: request.resource.kind,
            resource_id: request.resource.resource_id,
          },
        }
      : {}),
    ...(request.idempotency_key !== undefined
      ? { idempotency_key: request.idempotency_key }
      : {}),
    ...(request.approval_id !== undefined
      ? { approval_id: request.approval_id }
      : {}),
    ...(request.correlation_id !== undefined
      ? { correlation_id: request.correlation_id }
      : {}),
  };
}

function resolveCorrelationId(
  metadataCorrelationId: string | undefined,
  externalCorrelationId: string | undefined,
  requestId: string,
): string {
  return metadataCorrelationId ?? externalCorrelationId ?? requestId;
}

function denied(
  decision: GatewayDenialDecision,
  meta?: { request_id?: string; correlation_id?: string },
): GatewayResolutionDenied {
  return {
    status: "denied",
    decision,
    error: gatewayErrorFromDecision(decision),
    ...(meta?.request_id !== undefined ? { request_id: meta.request_id } : {}),
    ...(meta?.correlation_id !== undefined
      ? { correlation_id: meta.correlation_id }
      : {}),
  };
}

function invalid(
  code: Parameters<typeof gatewayErrorDescriptor>[0],
  meta?: { request_id?: string; correlation_id?: string },
): GatewayResolutionInvalid {
  return {
    status: "invalid",
    decision: null,
    error: gatewayErrorDescriptor(code),
    ...(meta?.request_id !== undefined ? { request_id: meta.request_id } : {}),
    ...(meta?.correlation_id !== undefined
      ? { correlation_id: meta.correlation_id }
      : {}),
  };
}

function mapPrincipalOutcome(
  outcome: Exclude<ResolvePrincipalResult["outcome"], "authenticated">,
): GatewayDenialDecision {
  return outcome;
}

function denialFromMembership(
  outcome: Exclude<ResolveMembershipResult["outcome"], "resolved">,
  meta: { request_id: string; correlation_id: string },
): GatewayResolutionDenied {
  if (outcome === "tenant_not_found") {
    // Décision catalogue = membership_missing ; code précis = TENANT_NOT_FOUND.
    return {
      status: "denied",
      decision: "tenant_membership_missing",
      error: gatewayErrorDescriptor("TENANT_NOT_FOUND"),
      ...meta,
    };
  }
  const decision: GatewayDenialDecision =
    outcome === "tenant_membership_missing"
      ? "tenant_membership_missing"
      : outcome === "tenant_membership_inactive"
        ? "tenant_membership_inactive"
        : outcome === "tenant_ambiguous"
          ? "tenant_ambiguous"
          : outcome === "actor_disabled"
            ? "actor_disabled"
            : "unavailable";
  return denied(decision, meta);
}

/**
 * Crée le Request Gateway de production.
 * Dépendances = resolvers (interfaces) — pas de client Supabase ici.
 */
export function createRequestGateway(
  dependencies: RequestGatewayDependencies,
): RequestGateway {
  const { principalResolver, membershipResolver } = dependencies;

  return {
    async resolve(request): Promise<GatewayResolution> {
      const parsed = gatewayRequestSchema.safeParse(request);
      if (!parsed.success) {
        const maybeMeta =
          request &&
          typeof request === "object" &&
          "requestMetadata" in request &&
          request.requestMetadata &&
          typeof request.requestMetadata === "object"
            ? (request.requestMetadata as {
                request_id?: unknown;
                correlation_id?: unknown;
              })
            : undefined;
        return invalid("GATEWAY_INPUT_INVALID", {
          ...(typeof maybeMeta?.request_id === "string"
            ? { request_id: maybeMeta.request_id }
            : {}),
          ...(typeof maybeMeta?.correlation_id === "string"
            ? { correlation_id: maybeMeta.correlation_id }
            : {}),
        });
      }

      const {
        externalRequest,
        authMaterial,
        requestMetadata,
        now,
      } = parsed.data;

      const requestId = requestMetadata.request_id;
      const correlationId = resolveCorrelationId(
        requestMetadata.correlation_id,
        externalRequest.correlation_id,
        requestId,
      );
      const meta = { request_id: requestId, correlation_id: correlationId };

      if (!authMaterial.credential_present) {
        return denied("unauthenticated", meta);
      }

      let principalResult: ResolvePrincipalResult;
      try {
        principalResult = await principalResolver.resolvePrincipal({
          authMaterial: {
            credential_present: authMaterial.credential_present,
            ...(authMaterial.bearer_token !== undefined
              ? { bearer_token: authMaterial.bearer_token }
              : {}),
            ...(authMaterial.session_id_hash !== undefined
              ? { session_id_hash: authMaterial.session_id_hash }
              : {}),
          },
          now,
        });
      } catch {
        // Masquer erreurs brutes auth / réseau.
        return denied("unavailable", meta);
      }

      if (principalResult.outcome !== "authenticated") {
        return denied(mapPrincipalOutcome(principalResult.outcome), meta);
      }

      let principal;
      try {
        principal = sanitizeAuthenticatedPrincipal(principalResult.principal);
      } catch (error) {
        if (error instanceof GatewayError && error.code === "ACTOR_DISABLED") {
          return denied("actor_disabled", meta);
        }
        return invalid("TRUST_CONTEXT_BUILD_FAILED", meta);
      }

      if (isPrincipalExpired(principal, now)) {
        return denied("expired_token", meta);
      }

      // Préférer le hash session du principal (resolver) ; fallback matériel.
      const sessionHash =
        principal.session_id_hash ?? authMaterial.session_id_hash;
      if (sessionHash !== undefined && principal.session_id_hash === undefined) {
        principal = { ...principal, session_id_hash: sessionHash };
      }

      let membershipResult: ResolveMembershipResult;
      try {
        membershipResult = await membershipResolver.resolveMembership({
          principal,
          now,
          ...(requestMetadata.requested_tenant_id !== undefined
            ? { requested_tenant_id: requestMetadata.requested_tenant_id }
            : {}),
        });
      } catch {
        return denied("unavailable", meta);
      }

      if (membershipResult.outcome !== "resolved") {
        return denialFromMembership(membershipResult.outcome, meta);
      }

      try {
        const context = buildTrustedExecutionContext({
          principal,
          tenant_id: membershipResult.tenant_id,
          roles: membershipResult.roles,
          request_id: requestId,
          correlation_id: correlationId,
          now,
        });

        return {
          status: "authenticated",
          decision: "authenticated",
          context,
          external_request: copyExternalRequest(externalRequest),
        };
      } catch {
        return invalid("TRUST_CONTEXT_BUILD_FAILED", meta);
      }
    },
  };
}
