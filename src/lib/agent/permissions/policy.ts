/**
 * Politique d’autorisation versionnée (G1-C).
 * Tout changement sémantique de allow/deny/require_approval → bump.
 */

export const PERMISSION_POLICY_VERSION = "perm_g1c_2026_07_24";

/** Noms stables des contrôles exécutés (explicabilité). */
export const PERMISSION_CHECKS = {
  request_schema: "request_schema",
  evaluation_context: "evaluation_context",
  tool_resolution: "tool_resolution",
  tool_status: "tool_status",
  mode: "mode",
  autonomy: "autonomy",
  resource_scope: "resource_scope",
  grants: "grants",
  human_validation: "human_validation",
} as const;

export type PermissionCheckName =
  (typeof PERMISSION_CHECKS)[keyof typeof PERMISSION_CHECKS];

/** Kinds de ressource structurée dérivables du scope outil. */
export const OBJECT_RESOURCE_KINDS = [
  "invoice",
  "receivable",
  "client",
  "account",
] as const;
