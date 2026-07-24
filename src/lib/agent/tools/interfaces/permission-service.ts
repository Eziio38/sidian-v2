/**
 * Interface future Permission Service (G1-C).
 * Aucune implémentation dans G1-B.
 */
export type PermissionDecision = {
  decision: "allow" | "deny" | "require_approval";
  reason_code: string;
  policy_version: string;
  scope: {
    tenant_id: string;
    resource_id?: string;
  };
};

export interface PermissionService {
  authorize(input: {
    actor_id: string;
    account_id: string;
    permission: string;
    resource_id?: string;
  }): Promise<PermissionDecision>;
}
