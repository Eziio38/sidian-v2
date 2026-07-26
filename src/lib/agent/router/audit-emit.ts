/**
 * Pont Router → Audit Service (G1-E) + sink de persistance (G1-F).
 * Construit l’entrée d’audit à partir de l’issue terminale — sans payload / secret / stack.
 * Après build réussi : au plus un `await auditSink.append(event)` (si sink injecté).
 * Champs G1-G : empreinte de clé, statut, fingerprint, execution_outcome (sanitizés).
 * Champs G1-H : approval_id / status / required / consumed / decision / failure_code.
 */

import { createHash } from "node:crypto";

import type {
  AuditBuildInput,
  AuditDecisionOutcome,
  AuditEvent,
  AuditExecutionOutcome,
  AuditIdempotencyStatus,
  AuditReasonCode,
  AuditResultKind,
  AuditService,
} from "@/lib/agent/audit";
import {
  AUDIT_PERSISTENCE_SAFE_MESSAGES,
  type AuditAppendFailure,
  type AuditSink,
} from "@/lib/agent/audit/persistence";
import type {
  PermissionDecision,
  PermissionResource,
} from "@/lib/agent/permissions/types";

import { ROUTER_ERROR_CATEGORY, type RouterErrorCode } from "./error-codes";
import type {
  ToolRouteBlocked,
  ToolRouteErrorDetails,
  ToolRouteResult,
  ToolRouteSuccess,
} from "./types";

export type AuditEmitIdentity = {
  correlation_id: string;
  tenant_id: string;
  actor_id: string;
  actor_type: "human" | "system";
  tool_id: string | null;
  tool_version: string | null;
  mode: "agir" | "conseiller" | "transmettre" | null;
  autonomy_requested: 0 | 1 | 2 | 3 | null;
  autonomy_maximum: 0 | 1 | 2 | 3 | null;
  resource?: PermissionResource;
  params_hash?: string | null;
  human_validation_id?: string;
  /** Empreinte de la clé — jamais la clé brute. */
  idempotency_key_hash?: string;
  idempotency_status?: AuditIdempotencyStatus;
  replayed?: boolean;
  request_fingerprint?: string;
  execution_outcome?: AuditExecutionOutcome;
  approval_id?: string;
  approval_status?: string;
  approval_required?: boolean;
  approval_consumed?: boolean;
  approval_decision?: string;
  approval_failure_code?: string;
};

export type AuditEmitOutcome = {
  decision: AuditDecisionOutcome;
  result: AuditResultKind;
  reason_code: AuditReasonCode;
  executor: string | null;
  output_hash?: string;
};

/** Empreinte opaque — jamais le payload brut. */
export function fingerprintOpaque(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex")
    .slice(0, 32);
}

/** Hash SHA-256 hex d’une clé d’idempotence — seul le hash part dans l’audit. */
export function hashIdempotencyKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function executorRef(
  toolId: string,
  toolVersion: string,
): string {
  return `${toolId}@${toolVersion}`;
}

/**
 * Mappe un blocage Router (+ éventuelle décision Permission) vers l’issue d’audit.
 */
export function mapBlockedToAuditOutcome(
  code: RouterErrorCode,
  options: {
    permissionDecision?: PermissionDecision | null;
    permissionAllowed?: boolean;
    executorInvoked?: boolean;
  } = {},
): AuditEmitOutcome {
  const {
    permissionDecision = null,
    permissionAllowed = false,
    executorInvoked = false,
  } = options;

  if (code === "PERMISSION_DENIED") {
    return {
      decision: "deny",
      result: "denied",
      reason_code: (permissionDecision?.reason_code ??
        "PERMISSION_DENIED") as AuditReasonCode,
      executor: null,
    };
  }

  if (code === "APPROVAL_REQUIRED") {
    return {
      decision: "require_approval",
      result: "approval_required",
      reason_code: (permissionDecision?.reason_code ??
        "VALIDATION_REQUIRED") as AuditReasonCode,
      executor: null,
    };
  }

  if (
    code === "APPROVAL_NOT_FOUND" ||
    code === "APPROVAL_PENDING" ||
    code === "APPROVAL_REJECTED" ||
    code === "APPROVAL_EXPIRED" ||
    code === "APPROVAL_ALREADY_CONSUMED" ||
    code === "APPROVAL_SCOPE_MISMATCH" ||
    code === "APPROVAL_PARAMS_MISMATCH" ||
    code === "APPROVAL_AUTONOMY_MISMATCH"
  ) {
    return {
      decision: "deny",
      result: "denied",
      reason_code: code,
      executor: null,
    };
  }

  if (code === "APPROVAL_CONSUMED_EXECUTION_NOT_STARTED") {
    return {
      decision: "allow",
      result: "technical_error",
      reason_code: "APPROVAL_CONSUMED_EXECUTION_NOT_STARTED",
      executor: null,
    };
  }

  if (code === "INVALID_ARGUMENT" || code === "ROUTER_INPUT_INVALID") {
    return {
      decision: "none",
      result: "validation_error",
      reason_code: code,
      executor: null,
    };
  }

  if (
    code === "EXECUTOR_BUSINESS_ERROR" ||
    code === "IDEMPOTENCY_REPLAY_FAILURE"
  ) {
    return {
      decision: "allow",
      result: "business_error",
      reason_code: code,
      executor: null, // rempli par l’appelant si connu
    };
  }

  // Technique / registry / schéma / fail-closed / persistance / idempotence
  // AUDIT_PERSISTENCE_FAILED n’emprunte pas ce chemin (échec sink post-build).
  const decision: AuditDecisionOutcome =
    permissionAllowed || executorInvoked ? "allow" : "none";

  return {
    decision,
    result: "technical_error",
    reason_code: code,
    executor: null,
  };
}

export function buildAuditDraft(
  identity: AuditEmitIdentity,
  outcome: AuditEmitOutcome,
): AuditBuildInput {
  const draft: AuditBuildInput = {
    correlation_id: identity.correlation_id,
    tenant: { tenant_id: identity.tenant_id },
    actor: {
      actor_id: identity.actor_id,
      actor_type: identity.actor_type,
    },
    tool: {
      tool_id: identity.tool_id,
      tool_version: identity.tool_version,
    },
    mode: identity.mode,
    autonomy: {
      requested: identity.autonomy_requested,
      maximum: identity.autonomy_maximum,
    },
    decision: outcome.decision,
    result: outcome.result,
    reason_code: outcome.reason_code,
    /** Horloge unique injectée — durée wall-clock interdite (déterminisme). */
    duration_ms: 0,
    params_hash: identity.params_hash ?? null,
    executor: outcome.executor,
  };

  if (identity.resource) {
    draft.resource = { ...identity.resource };
  }
  if (outcome.output_hash !== undefined) {
    draft.output_hash = outcome.output_hash;
  }
  if (identity.human_validation_id !== undefined) {
    draft.human_validation_id = identity.human_validation_id;
  }
  if (identity.idempotency_key_hash !== undefined) {
    draft.idempotency_key_hash = identity.idempotency_key_hash;
  }
  if (identity.idempotency_status !== undefined) {
    draft.idempotency_status = identity.idempotency_status;
  }
  if (identity.replayed !== undefined) {
    draft.replayed = identity.replayed;
  }
  if (identity.request_fingerprint !== undefined) {
    draft.request_fingerprint = identity.request_fingerprint;
  }
  if (identity.execution_outcome !== undefined) {
    draft.execution_outcome = identity.execution_outcome;
  }
  if (identity.approval_id !== undefined) {
    draft.approval_id = identity.approval_id;
  }
  if (identity.approval_status !== undefined) {
    draft.approval_status = identity.approval_status;
  }
  if (identity.approval_required !== undefined) {
    draft.approval_required = identity.approval_required;
  }
  if (identity.approval_consumed !== undefined) {
    draft.approval_consumed = identity.approval_consumed;
  }
  if (identity.approval_decision !== undefined) {
    draft.approval_decision = identity.approval_decision;
  }
  if (identity.approval_failure_code !== undefined) {
    draft.approval_failure_code = identity.approval_failure_code;
  }

  return draft;
}

/**
 * Identité minimale pour échecs précoces (requête invalide / correlation absente).
 * Sentinelles G1-E fixes (`"unresolved"`) — **pas** d’UUID / correlation inventés.
 * Documenté : si un sink est présent, l’append est quand même tenté une fois
 * après build réussi ; la base peut rejeter un `tenant_id` non-UUID → fail-closed.
 */
export function unresolvedIdentity(
  correlationId: string,
): AuditEmitIdentity {
  return {
    correlation_id: correlationId,
    tenant_id: "unresolved",
    actor_id: "unresolved",
    actor_type: "system",
    tool_id: null,
    tool_version: null,
    mode: null,
    autonomy_requested: null,
    autonomy_maximum: null,
    params_hash: null,
    execution_outcome: "not_started",
  };
}

function attachAudit(
  result: ToolRouteResult,
  audit: AuditEvent,
): ToolRouteResult {
  if (result.status === "success") {
    const withAudit: ToolRouteSuccess = { ...result, audit };
    return withAudit;
  }
  const withAudit: ToolRouteBlocked = { ...result, audit };
  return withAudit;
}

/**
 * Construit un résultat bloqué `AUDIT_PERSISTENCE_FAILED`.
 *
 * Important (G1-F) : si l’exécuteur a déjà eu un effet métier, cet échec de
 * persistance **n’annule pas** l’effet — pas d’atomicité externe / compensation
 * dans ce lot. Le résultat Router passe en blocked pour fail-closed observabilité.
 *
 * G1-G : si `complete`/`fail` a déjà réussi, l’enregistrement d’idempotence
 * reste **terminal** malgré cet échec audit.
 */
export function buildPersistenceFailedResult(
  prior: ToolRouteResult,
  failure: AuditAppendFailure,
  audit?: AuditEvent,
): ToolRouteBlocked {
  const details: ToolRouteErrorDetails = {
    persistence_code: failure.code,
    prior_status: prior.status,
  };
  if (prior.status === "blocked") {
    details.prior_error_code = prior.error.code;
  }

  const error: ToolRouteBlocked["error"] = {
    code: "AUDIT_PERSISTENCE_FAILED",
    category: ROUTER_ERROR_CATEGORY.AUDIT_PERSISTENCE_FAILED,
    message:
      failure.message ||
      AUDIT_PERSISTENCE_SAFE_MESSAGES.AUDIT_PERSISTENCE_FAILED,
    details,
  };

  const blocked: ToolRouteBlocked = {
    status: "blocked",
    error,
  };
  if (prior.status === "success") {
    blocked.tool_id = prior.tool_id;
    blocked.tool_version = prior.tool_version;
    blocked.correlation_id = prior.correlation_id;
  } else {
    if (prior.tool_id !== undefined) blocked.tool_id = prior.tool_id;
    if (prior.tool_version !== undefined) {
      blocked.tool_version = prior.tool_version;
    }
    if (prior.correlation_id !== undefined) {
      blocked.correlation_id = prior.correlation_id;
    }
  }
  if (audit) {
    blocked.audit = audit;
  }
  return blocked;
}

/**
 * Construit un résultat bloqué `AUDIT_BUILD_FAILED` (fail-closed G1-J).
 * Même caveat G1-F : un effet métier déjà produit n’est pas compensé.
 */
export function buildAuditBuildFailedResult(
  prior: ToolRouteResult,
): ToolRouteBlocked {
  const details: ToolRouteErrorDetails = {
    prior_status: prior.status,
  };
  if (prior.status === "blocked") {
    details.prior_error_code = prior.error.code;
  }

  const error: ToolRouteBlocked["error"] = {
    code: "AUDIT_BUILD_FAILED",
    category: ROUTER_ERROR_CATEGORY.AUDIT_BUILD_FAILED,
    message: "Échec de construction de l’événement d’audit.",
    details,
  };

  const blocked: ToolRouteBlocked = {
    status: "blocked",
    error,
  };
  if (prior.status === "success") {
    blocked.tool_id = prior.tool_id;
    blocked.tool_version = prior.tool_version;
    blocked.correlation_id = prior.correlation_id;
  } else {
    if (prior.tool_id !== undefined) blocked.tool_id = prior.tool_id;
    if (prior.tool_version !== undefined) {
      blocked.tool_version = prior.tool_version;
    }
    if (prior.correlation_id !== undefined) {
      blocked.correlation_id = prior.correlation_id;
    }
  }
  return blocked;
}

/**
 * Appelle `audit.build()` une fois, attache l’événement, puis — si un sink est
 * injecté — **exactement une** `await sink.append(event)` avant de retourner.
 *
 * - Build échoue → `AUDIT_BUILD_FAILED` (fail-closed) — **pas** d’append.
 * - Sink omis → build en mémoire uniquement (G1-E).
 * - Sink échoue / throw → `AUDIT_PERSISTENCE_FAILED` (pas de SQL/stack).
 * - `route()` attend l’append (await) avant de terminer.
 */
export async function emitAuditOnResult(
  auditService: AuditService,
  result: ToolRouteResult,
  draft: AuditBuildInput,
  now: string,
  auditSink?: AuditSink | null,
): Promise<ToolRouteResult> {
  let audit: AuditEvent;
  try {
    audit = auditService.build(draft, { now });
  } catch {
    // Build échoué — fail-closed, pas d’append silencieux.
    return buildAuditBuildFailedResult(result);
  }

  const withAudit = attachAudit(result, audit);

  if (!auditSink) {
    return withAudit;
  }

  try {
    const appendResult = await auditSink.append(audit);
    if (!appendResult.ok) {
      return buildPersistenceFailedResult(withAudit, appendResult, audit);
    }
    return withAudit;
  } catch {
    return buildPersistenceFailedResult(
      withAudit,
      {
        ok: false,
        code: "AUDIT_PERSISTENCE_FAILED",
        message: AUDIT_PERSISTENCE_SAFE_MESSAGES.AUDIT_PERSISTENCE_FAILED,
      },
      audit,
    );
  }
}
