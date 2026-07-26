/**
 * Assemble l’entrée Router **uniquement** depuis une résolution gateway authentifiée.
 * Aucune identité / grant / claim depuis le body externe.
 */

import type {
  ExternalToolRequest,
  GatewayResolutionAuthenticated,
  TrustedExecutionContext,
} from "./types";

/**
 * Intention outil validée pour le Router — données métier uniquement.
 * Alignée ExternalToolRequest ; pas de tenant/actor/roles/grants/claims.
 */
export type ValidatedToolIntent = {
  tool_id: string;
  tool_version: string;
  mode: ExternalToolRequest["mode"];
  requested_autonomy_level: ExternalToolRequest["requested_autonomy_level"];
  arguments: unknown;
  resource?: {
    kind: NonNullable<ExternalToolRequest["resource"]>["kind"];
    resource_id: string;
  };
  idempotency_key?: string;
  approval_id?: string;
  correlation_id?: string;
};

export type TrustedRouteInput = {
  request: ValidatedToolIntent;
  context: TrustedExecutionContext;
};

/**
 * Transforme GatewayResolutionAuthenticated → entrée Router de confiance.
 * Copie défensive — ne mute pas la résolution.
 */
export function toTrustedRouteInput(
  resolution: GatewayResolutionAuthenticated,
): TrustedRouteInput {
  const ext = resolution.external_request;
  const request: ValidatedToolIntent = {
    tool_id: ext.tool_id,
    tool_version: ext.tool_version,
    mode: ext.mode,
    requested_autonomy_level: ext.requested_autonomy_level,
    arguments: ext.arguments,
    ...(ext.resource !== undefined
      ? {
          resource: {
            kind: ext.resource.kind,
            resource_id: ext.resource.resource_id,
          },
        }
      : {}),
    ...(ext.idempotency_key !== undefined
      ? { idempotency_key: ext.idempotency_key }
      : {}),
    ...(ext.approval_id !== undefined
      ? { approval_id: ext.approval_id }
      : {}),
    ...(ext.correlation_id !== undefined
      ? { correlation_id: ext.correlation_id }
      : {}),
  };

  const ctx = resolution.context;
  const context: TrustedExecutionContext = {
    tenant_id: ctx.tenant_id,
    actor_id: ctx.actor_id,
    actor_type: ctx.actor_type,
    roles: [...ctx.roles],
    authentication_method: ctx.authentication_method,
    principal_subject: ctx.principal_subject,
    trust_level: ctx.trust_level,
    request_id: ctx.request_id,
    correlation_id: ctx.correlation_id,
    now: ctx.now,
    ...(ctx.authenticated_at !== undefined
      ? { authenticated_at: ctx.authenticated_at }
      : {}),
    ...(ctx.session_id_hash !== undefined
      ? { session_id_hash: ctx.session_id_hash }
      : {}),
  };

  return { request, context };
}
