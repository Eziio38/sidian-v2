/**
 * Mapping explicite AuditEvent (G1-E) → ligne `agent_audit_events`.
 * Déterministe hors `recorded_at` (défaut SQL).
 * Ne mute jamais l’événement source.
 */

import type { ParsedAuditEvent } from "@/lib/agent/audit/schemas";

import {
  AUDIT_EVENT_SCHEMA_VERSION,
  type AgentAuditEventInsert,
} from "./types";

/**
 * Construit une copie profonde de l’AuditEvent pour `event_payload`.
 * Champs optionnels omis s’ils sont absents (pas de null inventé).
 */
export function toEventPayload(event: ParsedAuditEvent): ParsedAuditEvent {
  const payload: ParsedAuditEvent = {
    audit_id: event.audit_id,
    timestamp: event.timestamp,
    correlation_id: event.correlation_id,
    tenant: { tenant_id: event.tenant.tenant_id },
    actor: {
      actor_id: event.actor.actor_id,
      actor_type: event.actor.actor_type,
    },
    tool: {
      tool_id: event.tool.tool_id,
      tool_version: event.tool.tool_version,
    },
    mode: event.mode,
    autonomy: {
      requested: event.autonomy.requested,
      maximum: event.autonomy.maximum,
    },
    decision: event.decision,
    result: event.result,
    reason_code: event.reason_code,
    duration_ms: event.duration_ms,
    params_hash: event.params_hash,
    executor: event.executor,
  };

  if (event.resource) {
    payload.resource = {
      kind: event.resource.kind,
      resource_id: event.resource.resource_id,
      tenant_id: event.resource.tenant_id,
    };
  }
  if (event.output_hash !== undefined) {
    payload.output_hash = event.output_hash;
  }
  if (event.human_validation_id !== undefined) {
    payload.human_validation_id = event.human_validation_id;
  }
  if (event.idempotency_key !== undefined) {
    payload.idempotency_key = event.idempotency_key;
  }
  if (event.idempotency_key_hash !== undefined) {
    payload.idempotency_key_hash = event.idempotency_key_hash;
  }
  if (event.idempotency_status !== undefined) {
    payload.idempotency_status = event.idempotency_status;
  }
  if (event.replayed !== undefined) {
    payload.replayed = event.replayed;
  }
  if (event.request_fingerprint !== undefined) {
    payload.request_fingerprint = event.request_fingerprint;
  }
  if (event.execution_outcome !== undefined) {
    payload.execution_outcome = event.execution_outcome;
  }
  if (event.approval_id !== undefined) {
    payload.approval_id = event.approval_id;
  }
  if (event.approval_status !== undefined) {
    payload.approval_status = event.approval_status;
  }
  if (event.approval_required !== undefined) {
    payload.approval_required = event.approval_required;
  }
  if (event.approval_consumed !== undefined) {
    payload.approval_consumed = event.approval_consumed;
  }
  if (event.approval_decision !== undefined) {
    payload.approval_decision = event.approval_decision;
  }
  if (event.approval_failure_code !== undefined) {
    payload.approval_failure_code = event.approval_failure_code;
  }

  return payload;
}

/**
 * Mapping colonnes SQL — une seule source de vérité pour l’insert.
 * Champs uniquement présents dans le payload JSON : duration_ms,
 * autonomy.maximum, human_validation_id, idempotency_key.
 */
export function mapAuditEventToInsert(
  event: ParsedAuditEvent,
): AgentAuditEventInsert {
  return {
    audit_id: event.audit_id,
    schema_version: AUDIT_EVENT_SCHEMA_VERSION,
    occurred_at: event.timestamp,
    correlation_id: event.correlation_id,
    tenant_id: event.tenant.tenant_id,
    actor_id: event.actor.actor_id,
    actor_type: event.actor.actor_type,
    tool_id: event.tool.tool_id,
    tool_version: event.tool.tool_version,
    mode: event.mode,
    requested_autonomy_level: event.autonomy.requested,
    decision: event.decision,
    result_status: event.result,
    reason_code: event.reason_code,
    resource_kind: event.resource?.kind ?? null,
    resource_id: event.resource?.resource_id ?? null,
    params_hash: event.params_hash,
    output_hash: event.output_hash ?? null,
    executor_id: event.executor,
    event_payload: toEventPayload(event),
  };
}
