/**
 * Dérivation serveur des grants (G1-K).
 * Jamais depuis le body ExternalToolRequest / ValidatedToolIntent.
 *
 * EPICU V1 : membership authentifiée (rôles allowlist) → grants = permissions
 * requises par la ToolDefinition, scopées au `tenant_id` du TrustedExecutionContext.
 * Le filtrage mode / autonomie / HV reste au Permission Service.
 */

import type { TrustedExecutionContext } from "@/lib/agent/gateway/types";
import type {
  AgentMode,
  PermissionGrant,
} from "@/lib/agent/permissions/types";

export type DeriveGrantsToolRef = {
  tool_id: string;
  tool_version: string;
};

export type DeriveGrantsInput = {
  trustedContext: Pick<TrustedExecutionContext, "tenant_id" | "roles">;
  toolRef: DeriveGrantsToolRef;
  mode: AgentMode;
  /** Permissions requises résolues depuis la ToolDefinition (registry de confiance). */
  required_permissions: readonly string[];
  /** resource_id métier optionnel — jamais un tenant_id client. */
  resource_id?: string;
};

/**
 * Construit les grants de confiance pour Permission Service.
 * `toolRef` + `mode` sont conservés pour traçabilité / extensions futures ;
 * V1 n’invente pas de permissions hors `required_permissions`.
 */
export function deriveGrants(input: DeriveGrantsInput): PermissionGrant[] {
  const { trustedContext, required_permissions, resource_id } = input;

  // Fail-closed : pas de rôles trusted → aucun grant.
  if (!trustedContext.roles || trustedContext.roles.length === 0) {
    return [];
  }

  if (!required_permissions || required_permissions.length === 0) {
    return [];
  }

  const tenantId = trustedContext.tenant_id;
  const grants: PermissionGrant[] = [];

  for (const permission of required_permissions) {
    if (typeof permission !== "string" || permission.length === 0) {
      continue;
    }
    const grant: PermissionGrant = {
      permission,
      tenant_id: tenantId,
    };
    if (resource_id !== undefined && resource_id.length > 0) {
      grant.resource_id = resource_id;
    }
    grants.push(grant);
  }

  return grants;
}
