/**
 * Human Approval Service persistant avec consommation atomique (G1-H).
 * Orchestration request / decide / inspect / consume — aucune I/O directe
 * (repository injecté). Horloge injectée via l’entrée — jamais Date.now().
 *
 * Intégration (hors de ce module — Router / orchestrateur de confiance) :
 * 1. inspect(approval_id) → HumanValidationRecord de confiance ;
 * 2. Permission Service pur (G1-C) — ne consomme jamais ;
 * 3. claim idempotence (G1-G) ;
 * 4. consume atomique seulement si claim acquired ;
 * 5. exécuteur uniquement si consume.outcome === "consumed".
 */

import type { HumanValidationRecord } from "@/lib/agent/permissions/types";

import { ApprovalError } from "./errors";
import { resourceColumns, type ApprovalRepository } from "./repository";
import {
  approvalConsumptionInputSchema,
  approvalDecisionInputSchema,
  approvalInspectionInputSchema,
  approvalRequestInputSchema,
} from "./schemas";
import {
  createSupabaseApprovalRepository,
  type ApprovalPersistenceClient,
} from "./supabase-approval-repository";
import type {
  ApprovalConsumptionBlocked,
  ApprovalConsumptionInput,
  ApprovalConsumptionResult,
  ApprovalDecisionInput,
  ApprovalDecisionResult,
  ApprovalErrorCode,
  ApprovalInspectionFound,
  ApprovalInspectionInput,
  ApprovalInspectionResult,
  ApprovalRequestInput,
  ApprovalRequestResult,
  ApprovalResource,
  ApprovalSqlConsumeResult,
  ApprovalStatus,
  HumanApprovalService,
} from "./types";

function parseInstantMs(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function addSecondsIso(nowIso: string, ttlSeconds: number): string {
  const ms = parseInstantMs(nowIso);
  if (ms === null) {
    throw new ApprovalError("APPROVAL_INPUT_INVALID");
  }
  return new Date(ms + ttlSeconds * 1000).toISOString();
}

function resolveExpiresAt(
  now: string,
  expiresAt: string | undefined,
  ttlSeconds: number | undefined,
): string {
  if (expiresAt !== undefined) {
    const expMs = parseInstantMs(expiresAt);
    const nowMs = parseInstantMs(now);
    if (expMs === null || nowMs === null) {
      throw new ApprovalError("APPROVAL_INPUT_INVALID");
    }
    if (expMs <= nowMs) {
      throw new ApprovalError("APPROVAL_INPUT_INVALID");
    }
    return expiresAt;
  }
  if (ttlSeconds === undefined) {
    throw new ApprovalError("APPROVAL_INPUT_INVALID");
  }
  return addSecondsIso(now, ttlSeconds);
}

function isLogicallyExpired(
  status: ApprovalStatus,
  expiresAt: string,
  now: string,
): boolean {
  if (status !== "pending" && status !== "approved") {
    return false;
  }
  const expMs = parseInstantMs(expiresAt);
  const nowMs = parseInstantMs(now);
  if (expMs === null || nowMs === null) {
    // Horloge indéterminable → fail-closed : traiter comme expiré.
    return true;
  }
  return nowMs >= expMs;
}

function rebuildResource(
  tenantId: string,
  resourceKind: string | null,
  resourceId: string | null,
): ApprovalResource | undefined {
  if (!resourceKind || !resourceId) {
    return undefined;
  }
  return {
    kind: resourceKind as ApprovalResource["kind"],
    resource_id: resourceId,
    tenant_id: tenantId,
  };
}

function mapConsumeBlocked(
  sqlResult: Exclude<ApprovalSqlConsumeResult, "consumed">,
  approvalId: string | null,
  status: ApprovalStatus | null,
): ApprovalConsumptionResult {
  const codeByResult: Record<
    Exclude<ApprovalSqlConsumeResult, "consumed">,
    ApprovalErrorCode
  > = {
    pending: "APPROVAL_PENDING",
    rejected: "APPROVAL_REJECTED",
    expired: "APPROVAL_EXPIRED",
    already_consumed: "APPROVAL_ALREADY_CONSUMED",
    scope_mismatch: "APPROVAL_SCOPE_MISMATCH",
    params_mismatch: "APPROVAL_PARAMS_MISMATCH",
    autonomy_mismatch: "APPROVAL_AUTONOMY_MISMATCH",
    not_found: "APPROVAL_NOT_FOUND",
    unavailable: "APPROVAL_UNAVAILABLE",
  };

  const blocked: ApprovalConsumptionBlocked = {
    outcome: sqlResult,
    code: codeByResult[sqlResult],
  };
  if (approvalId) {
    blocked.approval_id = approvalId;
  }
  if (status) {
    blocked.status = status;
  }
  return blocked;
}

/**
 * Mappe une inspection trouvée vers le contrat G1-C `HumanValidationRecord`.
 * Statuts terminaux non reconnus par G1-C (`consumed`, `cancelled`) → `expired`
 * (refus déterministe, pas de réutilisation).
 */
export function toTrustedHumanValidation(
  inspection: ApprovalInspectionFound,
): HumanValidationRecord {
  let status: HumanValidationRecord["status"];
  switch (inspection.status) {
    case "pending":
      status = "pending";
      break;
    case "approved":
      status = "approved";
      break;
    case "rejected":
      status = "rejected";
      break;
    case "expired":
    case "consumed":
    case "cancelled":
      status = "expired";
      break;
    default: {
      const _exhaustive: never = inspection.status;
      void _exhaustive;
      status = "expired";
    }
  }

  const record: HumanValidationRecord = {
    validation_id: inspection.approval_id,
    status,
    bound_tenant_id: inspection.tenant_id,
    bound_tool_id: inspection.tool_id,
    bound_tool_version: inspection.tool_version,
    bound_mode: inspection.mode,
    bound_params_hash: inspection.params_hash,
    expires_at: inspection.expires_at,
  };

  if (inspection.resource) {
    record.bound_resource = inspection.resource;
  }

  return record;
}

/**
 * Crée le service d’approbation humaine.
 * @param repository Repository injecté (Supabase ou fake mémoire).
 */
export function createHumanApprovalService(
  repository: ApprovalRepository,
): HumanApprovalService {
  return {
    async request(
      input: ApprovalRequestInput,
    ): Promise<ApprovalRequestResult> {
      const parsed = approvalRequestInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new ApprovalError("APPROVAL_INPUT_INVALID");
      }

      const nowMs = parseInstantMs(parsed.data.now);
      if (nowMs === null) {
        throw new ApprovalError("APPROVAL_INPUT_INVALID");
      }

      const expiresAt = resolveExpiresAt(
        parsed.data.now,
        parsed.data.expires_at,
        parsed.data.ttl_seconds,
      );

      const { resource_kind, resource_id } = resourceColumns(
        parsed.data.resource,
      );

      try {
        return await repository.create({
          tenant_id: parsed.data.tenant_id,
          request_fingerprint: parsed.data.request_fingerprint,
          params_hash: parsed.data.params_hash,
          tool_id: parsed.data.tool_id,
          tool_version: parsed.data.tool_version,
          mode: parsed.data.mode,
          requested_autonomy_level: parsed.data.requested_autonomy_level,
          resource_kind,
          resource_id,
          requester_actor_id: parsed.data.requester_actor.actor_id,
          requester_actor_type: parsed.data.requester_actor.actor_type,
          now: parsed.data.now,
          expires_at: expiresAt,
        });
      } catch (err) {
        if (err instanceof ApprovalError) {
          throw err;
        }
        throw new ApprovalError("APPROVAL_REQUEST_FAILED");
      }
    },

    async decide(
      input: ApprovalDecisionInput,
    ): Promise<ApprovalDecisionResult> {
      const parsed = approvalDecisionInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new ApprovalError("APPROVAL_INPUT_INVALID");
      }

      if (!parsed.data.decided_by_actor_id.trim()) {
        throw new ApprovalError("APPROVAL_ACTOR_UNAUTHORIZED");
      }

      const nowMs = parseInstantMs(parsed.data.now);
      if (nowMs === null) {
        throw new ApprovalError("APPROVAL_INPUT_INVALID");
      }

      try {
        return await repository.decide({
          approval_id: parsed.data.approval_id,
          tenant_id: parsed.data.tenant_id,
          decision: parsed.data.decision,
          decided_by_actor_id: parsed.data.decided_by_actor_id.trim(),
          decision_reason_code: parsed.data.reason_code,
          now: parsed.data.now,
        });
      } catch (err) {
        if (err instanceof ApprovalError) {
          throw err;
        }
        throw new ApprovalError("APPROVAL_DECISION_FAILED");
      }
    },

    async inspect(
      input: ApprovalInspectionInput,
    ): Promise<ApprovalInspectionResult> {
      const parsed = approvalInspectionInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new ApprovalError("APPROVAL_INPUT_INVALID");
      }

      try {
        const row = await repository.inspect({
          approval_id: parsed.data.approval_id,
          tenant_id: parsed.data.tenant_id,
          now: parsed.data.now,
        });

        if (!row.found) {
          return { found: false, code: "APPROVAL_NOT_FOUND" };
        }

        const logicallyExpired = isLogicallyExpired(
          row.status,
          row.expires_at,
          parsed.data.now,
        );

        const status: ApprovalStatus = logicallyExpired
          ? "expired"
          : row.status;

        const found: ApprovalInspectionFound = {
          found: true,
          approval_id: row.approval_id,
          tenant_id: row.tenant_id,
          status,
          request_fingerprint: row.request_fingerprint,
          params_hash: row.params_hash,
          tool_id: row.tool_id,
          tool_version: row.tool_version,
          mode: row.mode,
          requested_autonomy_level: row.requested_autonomy_level,
          requested_at: row.requested_at,
          expires_at: row.expires_at,
        };

        const resource = rebuildResource(
          row.tenant_id,
          row.resource_kind,
          row.resource_id,
        );
        if (resource) {
          found.resource = resource;
        }
        if (row.decided_at) {
          found.decided_at = row.decided_at;
        }
        if (row.decided_by_actor_id) {
          found.decided_by_actor_id = row.decided_by_actor_id;
        }
        if (row.decision_reason_code) {
          found.decision_reason_code = row.decision_reason_code;
        }
        if (row.consumed_at) {
          found.consumed_at = row.consumed_at;
        }
        if (row.consumed_by_correlation_id) {
          found.consumed_by_correlation_id = row.consumed_by_correlation_id;
        }
        if (logicallyExpired) {
          found.logically_expired = true;
        }

        return found;
      } catch (err) {
        if (err instanceof ApprovalError) {
          if (err.code === "APPROVAL_NOT_FOUND") {
            return { found: false, code: "APPROVAL_NOT_FOUND" };
          }
          if (
            err.code === "APPROVAL_UNAVAILABLE" ||
            err.code === "APPROVAL_REQUEST_FAILED" ||
            err.code === "APPROVAL_DECISION_FAILED" ||
            err.code === "APPROVAL_CONSUMPTION_FAILED"
          ) {
            return { found: false, code: "APPROVAL_UNAVAILABLE" };
          }
          throw err;
        }
        return { found: false, code: "APPROVAL_UNAVAILABLE" };
      }
    },

    async consume(
      input: ApprovalConsumptionInput,
    ): Promise<ApprovalConsumptionResult> {
      const parsed = approvalConsumptionInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new ApprovalError("APPROVAL_INPUT_INVALID");
      }

      const nowMs = parseInstantMs(parsed.data.now);
      if (nowMs === null) {
        throw new ApprovalError("APPROVAL_INPUT_INVALID");
      }

      const { resource_kind, resource_id } = resourceColumns(
        parsed.data.resource,
      );

      try {
        const result = await repository.consume({
          approval_id: parsed.data.approval_id,
          tenant_id: parsed.data.tenant_id,
          request_fingerprint: parsed.data.request_fingerprint,
          params_hash: parsed.data.params_hash,
          tool_id: parsed.data.tool_id,
          tool_version: parsed.data.tool_version,
          mode: parsed.data.mode,
          requested_autonomy_level: parsed.data.requested_autonomy_level,
          resource_kind,
          resource_id,
          correlation_id: parsed.data.correlation_id,
          idempotency_key_hash: parsed.data.idempotency_key_hash,
          now: parsed.data.now,
        });

        if (result.sql_result === "consumed") {
          if (!result.approval_id || !result.consumed_at) {
            return {
              outcome: "unavailable",
              code: "APPROVAL_UNAVAILABLE",
            };
          }
          return {
            outcome: "consumed",
            approval_id: result.approval_id,
            status: "consumed",
            consumed_at: result.consumed_at,
          };
        }

        return mapConsumeBlocked(
          result.sql_result,
          result.approval_id,
          result.status,
        );
      } catch (err) {
        if (err instanceof ApprovalError) {
          if (err.code === "APPROVAL_INPUT_INVALID") {
            throw err;
          }
          // Fail-closed : états métier remappés en résultat structuré ;
          // erreurs d’infra → unavailable (Router ne doit pas exécuter).
          const outcomeByCode: Partial<
            Record<ApprovalErrorCode, Exclude<ApprovalSqlConsumeResult, "consumed">>
          > = {
            APPROVAL_PENDING: "pending",
            APPROVAL_REJECTED: "rejected",
            APPROVAL_EXPIRED: "expired",
            APPROVAL_ALREADY_CONSUMED: "already_consumed",
            APPROVAL_SCOPE_MISMATCH: "scope_mismatch",
            APPROVAL_PARAMS_MISMATCH: "params_mismatch",
            APPROVAL_AUTONOMY_MISMATCH: "autonomy_mismatch",
            APPROVAL_NOT_FOUND: "not_found",
            APPROVAL_UNAVAILABLE: "unavailable",
            APPROVAL_CONSUMPTION_FAILED: "unavailable",
            APPROVAL_REQUEST_FAILED: "unavailable",
            APPROVAL_DECISION_FAILED: "unavailable",
            APPROVAL_ACTOR_UNAUTHORIZED: "unavailable",
            APPROVAL_NOT_REQUIRED: "unavailable",
          };
          const outcome = outcomeByCode[err.code] ?? "unavailable";
          return mapConsumeBlocked(outcome, parsed.data.approval_id, null);
        }
        return {
          outcome: "unavailable",
          code: "APPROVAL_UNAVAILABLE",
          approval_id: parsed.data.approval_id,
        };
      }
    },
  };
}

/**
 * Raccourci production : client Supabase injecté → service prêt pour le Router.
 */
export function createSupabaseHumanApprovalService(
  client: ApprovalPersistenceClient,
): HumanApprovalService {
  return createHumanApprovalService(
    createSupabaseApprovalRepository(client),
  );
}
