/**
 * Permission Service déterministe (G1-C).
 * Fonction pure — aucune I/O, aucune exécution d’outil, aucune horloge globale.
 */

import type { ToolDefinition } from "@/lib/agent/tools/definition-schema";

import {
  OBJECT_RESOURCE_KINDS,
  PERMISSION_CHECKS,
  PERMISSION_POLICY_VERSION,
} from "./policy";
import {
  permissionEvaluationContextSchema,
  permissionRequestSchema,
} from "./request-schema";
import type { PermissionErrorCode, PermissionReasonCode } from "./reason-codes";
import type {
  AutonomyLevel,
  AgentMode,
  PermissionDecision,
  PermissionGrant,
  PermissionResource,
  PermissionService,
  PermissionServiceDependencies,
  ResolveToolDefinition,
} from "./types";

type EvalState = {
  checks: string[];
  required_permissions: string[];
  matching_grants: PermissionGrant[];
  tool_id: string | null;
  tool_version: string | null;
  mode: AgentMode | null;
  autonomy: { requested: AutonomyLevel | null; maximum: AutonomyLevel | null };
  human_validation_required: boolean;
  scope_tenant_id: string;
  scope_resource_id?: string;
};

function emptyState(partial?: Partial<EvalState>): EvalState {
  return {
    checks: [],
    required_permissions: [],
    matching_grants: [],
    tool_id: null,
    tool_version: null,
    mode: null,
    autonomy: { requested: null, maximum: null },
    human_validation_required: false,
    scope_tenant_id: "",
    ...partial,
  };
}

function decide(
  decision: PermissionDecision["decision"],
  reason_code: PermissionReasonCode,
  state: EvalState,
  opts?: {
    failed_check?: string;
    error_code?: PermissionErrorCode;
  },
): PermissionDecision {
  const out: PermissionDecision = {
    decision,
    reason_code,
    policy_version: PERMISSION_POLICY_VERSION,
    scope: {
      tenant_id: state.scope_tenant_id || "unknown",
      ...(state.scope_resource_id
        ? { resource_id: state.scope_resource_id }
        : {}),
    },
    checks: [...state.checks],
    required_permissions: [...state.required_permissions],
    matching_grants: state.matching_grants.map((g) => ({ ...g })),
    tool_id: state.tool_id,
    tool_version: state.tool_version,
    mode: state.mode,
    autonomy: { ...state.autonomy },
    human_validation_required: state.human_validation_required,
  };
  if (opts?.failed_check) {
    out.failed_check = opts.failed_check;
  }
  if (opts?.error_code) {
    out.error_code = opts.error_code;
  }
  return out;
}

function denyClosed(state: EvalState): PermissionDecision {
  return decide("deny", "POLICY_EVALUATION_FAILED", state, {
    failed_check: "policy_evaluation",
    error_code: "PERMISSION_EVALUATION_FAILED",
  });
}

function isObjectResourceKind(
  value: string,
): value is (typeof OBJECT_RESOURCE_KINDS)[number] {
  return (OBJECT_RESOURCE_KINDS as readonly string[]).includes(value);
}

function resourcesEqual(
  a: PermissionResource | undefined,
  b: PermissionResource | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.kind === b.kind &&
    a.resource_id === b.resource_id &&
    a.tenant_id === b.tenant_id
  );
}

/**
 * Compare deux instants ISO via timestamps injectés (pas d’horloge globale).
 * Retourne true si expiresAt <= now (expiré).
 */
function isExpiredAt(expiresAt: string, nowIso: string): boolean {
  const expiresMs = Date.parse(expiresAt);
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(expiresMs) || Number.isNaN(nowMs)) {
    return true;
  }
  return expiresMs <= nowMs;
}

function findMatchingGrants(
  required: string[],
  grants: PermissionGrant[],
  tenantId: string,
  resourceId: string | undefined,
): {
  ok: boolean;
  reason: "missing" | "tenant" | "resource" | null;
  matching: PermissionGrant[];
} {
  const matching: PermissionGrant[] = [];

  for (const permission of required) {
    const candidates = grants.filter((g) => g.permission === permission);
    if (candidates.length === 0) {
      return { ok: false, reason: "missing", matching };
    }

    const tenantOk = candidates.filter((g) => g.tenant_id === tenantId);
    if (tenantOk.length === 0) {
      return { ok: false, reason: "tenant", matching };
    }

    const scoped = tenantOk.filter((g) => {
      if (g.resource_id === undefined) return true;
      if (resourceId === undefined) return false;
      return g.resource_id === resourceId;
    });

    if (scoped.length === 0) {
      return { ok: false, reason: "resource", matching };
    }

    matching.push(scoped[0]!);
  }

  return { ok: true, reason: null, matching };
}

function evaluateAuthorize(
  requestInput: unknown,
  contextInput: unknown,
  resolveToolDefinition: ResolveToolDefinition,
): PermissionDecision {
  const state = emptyState();

  const contextParsed = permissionEvaluationContextSchema.safeParse(contextInput);
  state.checks.push(PERMISSION_CHECKS.evaluation_context);
  if (!contextParsed.success) {
    return decide("deny", "INPUT_INVALID", state, {
      failed_check: PERMISSION_CHECKS.evaluation_context,
      error_code: "PERMISSION_DENIED",
    });
  }
  const context = contextParsed.data;

  const requestParsed = permissionRequestSchema.safeParse(requestInput);
  state.checks.push(PERMISSION_CHECKS.request_schema);
  if (!requestParsed.success) {
    return decide("deny", "INPUT_INVALID", state, {
      failed_check: PERMISSION_CHECKS.request_schema,
      error_code: "PERMISSION_DENIED",
    });
  }
  const request = requestParsed.data;

  state.scope_tenant_id = request.tenant_id;
  state.scope_resource_id = request.resource?.resource_id;
  state.tool_id = request.tool_id;
  state.tool_version = request.tool_version;
  state.mode = request.mode;
  state.autonomy = {
    requested: request.requested_autonomy_level,
    maximum: null,
  };

  // 3. Résolution outil (dépendance de confiance)
  state.checks.push(PERMISSION_CHECKS.tool_resolution);
  let definition: ToolDefinition | null;
  try {
    definition = resolveToolDefinition(request.tool_id, request.tool_version);
  } catch {
    return denyClosed(state);
  }

  if (definition === null) {
    return decide("deny", "TOOL_UNRESOLVED", state, {
      failed_check: PERMISSION_CHECKS.tool_resolution,
      error_code: "PERMISSION_DENIED",
    });
  }

  state.required_permissions = [...definition.permissions.required];
  state.human_validation_required =
    definition.autonomy.human_validation_required;
  state.autonomy.maximum = definition.autonomy.maximum_level;

  // 4. Statut Production uniquement
  state.checks.push(PERMISSION_CHECKS.tool_status);
  if (definition.status !== "Production") {
    return decide("deny", "TOOL_NOT_CALLABLE", state, {
      failed_check: PERMISSION_CHECKS.tool_status,
      error_code: "PERMISSION_DENIED",
    });
  }

  // 5. Mode
  state.checks.push(PERMISSION_CHECKS.mode);
  if (!definition.autonomy.allowed_modes.includes(request.mode)) {
    return decide("deny", "MODE_NOT_ALLOWED", state, {
      failed_check: PERMISSION_CHECKS.mode,
      error_code: "PERMISSION_DENIED",
    });
  }

  // 6. Autonomie — une approbation ne peut jamais augmenter le max
  state.checks.push(PERMISSION_CHECKS.autonomy);
  if (request.requested_autonomy_level > definition.autonomy.maximum_level) {
    return decide("deny", "AUTONOMY_EXCEEDED", state, {
      failed_check: PERMISSION_CHECKS.autonomy,
      error_code: "PERMISSION_DENIED",
    });
  }

  // 7. Scope ressource dérivé de ToolDefinition.permissions.scope
  state.checks.push(PERMISSION_CHECKS.resource_scope);
  const objectScopes = definition.permissions.scope.filter(isObjectResourceKind);
  const allowsTenantLevel = definition.permissions.scope.includes("tenant");

  if (objectScopes.length > 0) {
    if (!request.resource) {
      // Outils mixtes (ex. protection.draft.*) : invocation tenant autorisée
      // tant que "tenant" est dans le scope ; la ressource objet reste optionnelle.
      if (!allowsTenantLevel) {
        return decide("deny", "RESOURCE_SCOPE_MISMATCH", state, {
          failed_check: PERMISSION_CHECKS.resource_scope,
          error_code: "PERMISSION_DENIED",
        });
      }
    } else if (!objectScopes.includes(request.resource.kind)) {
      return decide("deny", "RESOURCE_SCOPE_MISMATCH", state, {
        failed_check: PERMISSION_CHECKS.resource_scope,
        error_code: "PERMISSION_DENIED",
      });
    } else if (request.resource.tenant_id !== request.tenant_id) {
      return decide("deny", "TENANT_SCOPE_MISMATCH", state, {
        failed_check: PERMISSION_CHECKS.resource_scope,
        error_code: "PERMISSION_DENIED",
      });
    }
  } else if (request.resource) {
    if (request.resource.tenant_id !== request.tenant_id) {
      return decide("deny", "TENANT_SCOPE_MISMATCH", state, {
        failed_check: PERMISSION_CHECKS.resource_scope,
        error_code: "PERMISSION_DENIED",
      });
    }
  }

  // 8. Grants explicites — absence d’interdiction ≠ autorisation
  state.checks.push(PERMISSION_CHECKS.grants);
  if (request.grants.length === 0) {
    return decide("deny", "PERMISSION_MISSING", state, {
      failed_check: PERMISSION_CHECKS.grants,
      error_code: "PERMISSION_DENIED",
    });
  }

  const grantResult = findMatchingGrants(
    definition.permissions.required,
    request.grants,
    request.tenant_id,
    request.resource?.resource_id,
  );
  state.matching_grants = grantResult.matching;

  if (!grantResult.ok) {
    if (grantResult.reason === "tenant") {
      return decide("deny", "TENANT_SCOPE_MISMATCH", state, {
        failed_check: PERMISSION_CHECKS.grants,
        error_code: "PERMISSION_DENIED",
      });
    }
    if (grantResult.reason === "resource") {
      return decide("deny", "RESOURCE_SCOPE_MISMATCH", state, {
        failed_check: PERMISSION_CHECKS.grants,
        error_code: "PERMISSION_DENIED",
      });
    }
    return decide("deny", "PERMISSION_MISSING", state, {
      failed_check: PERMISSION_CHECKS.grants,
      error_code: "PERMISSION_DENIED",
    });
  }

  // 9. Validation humaine (si exigée par la définition)
  state.checks.push(PERMISSION_CHECKS.human_validation);
  if (definition.autonomy.human_validation_required) {
    const hv = request.human_validation;
    if (!hv) {
      return decide("require_approval", "VALIDATION_REQUIRED", state, {
        failed_check: PERMISSION_CHECKS.human_validation,
        error_code: "VALIDATION_REQUIRED",
      });
    }

    if (hv.status === "pending") {
      return decide("require_approval", "VALIDATION_PENDING", state, {
        failed_check: PERMISSION_CHECKS.human_validation,
        error_code: "VALIDATION_PENDING",
      });
    }

    if (hv.status === "rejected") {
      return decide("deny", "VALIDATION_REJECTED", state, {
        failed_check: PERMISSION_CHECKS.human_validation,
        error_code: "VALIDATION_REJECTED",
      });
    }

    if (hv.status === "expired") {
      return decide("deny", "VALIDATION_EXPIRED", state, {
        failed_check: PERMISSION_CHECKS.human_validation,
        error_code: "VALIDATION_EXPIRED",
      });
    }

    // status === approved
    if (hv.expires_at !== undefined && isExpiredAt(hv.expires_at, context.now)) {
      return decide("deny", "VALIDATION_EXPIRED", state, {
        failed_check: PERMISSION_CHECKS.human_validation,
        error_code: "VALIDATION_EXPIRED",
      });
    }

    if (request.current_params_hash === undefined) {
      return decide("deny", "INPUT_INVALID", state, {
        failed_check: PERMISSION_CHECKS.human_validation,
        error_code: "PERMISSION_DENIED",
      });
    }

    // Hash modifié = expiration logique des paramètres (EVAL-MODE-010 / TOOL-017)
    if (hv.bound_params_hash !== request.current_params_hash) {
      return decide("deny", "VALIDATION_EXPIRED", state, {
        failed_check: PERMISSION_CHECKS.human_validation,
        error_code: "VALIDATION_EXPIRED",
      });
    }

    if (
      hv.bound_tenant_id !== request.tenant_id ||
      hv.bound_tool_id !== request.tool_id ||
      hv.bound_tool_version !== request.tool_version ||
      hv.bound_mode !== request.mode ||
      !resourcesEqual(hv.bound_resource, request.resource)
    ) {
      return decide("deny", "VALIDATION_SCOPE_MISMATCH", state, {
        failed_check: PERMISSION_CHECKS.human_validation,
        error_code: "VALIDATION_SCOPE_MISMATCH",
      });
    }
  }

  return decide("allow", "ALLOW", state);
}

/**
 * Crée un Permission Service pur à partir d’une dépendance de résolution d’outil.
 */
export function createPermissionService(
  deps: PermissionServiceDependencies,
): PermissionService {
  const { resolveToolDefinition } = deps;

  return {
    authorize(request: unknown, context: unknown): PermissionDecision {
      try {
        return evaluateAuthorize(request, context, resolveToolDefinition);
      } catch {
        return denyClosed(emptyState());
      }
    },
  };
}

/** Registre mémoire pour tests — aucune I/O. */
export function createMemoryToolResolver(
  definitions: ToolDefinition[],
): ResolveToolDefinition {
  const map = new Map<string, ToolDefinition>();
  for (const def of definitions) {
    map.set(`${def.tool_id}@${def.version}`, def);
  }
  return (toolId, version) => map.get(`${toolId}@${version}`) ?? null;
}
