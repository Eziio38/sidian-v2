/**
 * Construction pure d’un AuditEvent (G1-E).
 * Déterministe : mêmes entrées + même contexte → même événement (y compris audit_id).
 * Aucune I/O, aucune horloge globale, aucune mutation des entrées.
 */

import { createHash } from "node:crypto";

import {
  auditBuildContextSchema,
  auditBuildInputSchema,
  type ParsedAuditBuildContext,
  type ParsedAuditBuildInput,
} from "./schemas";
import { AuditBuildError, type AuditEvent, type AuditResource } from "./types";

function copyResource(resource: AuditResource): AuditResource {
  return {
    kind: resource.kind,
    resource_id: resource.resource_id,
    tenant_id: resource.tenant_id,
  };
}

/**
 * Canonicalisation stable pour empreinte — clés ordonnées, pas de payload.
 */
function canonicalForId(input: ParsedAuditBuildInput, timestamp: string): string {
  return JSON.stringify({
    actor_id: input.actor.actor_id,
    actor_type: input.actor.actor_type,
    approval_consumed: input.approval_consumed ?? null,
    approval_decision: input.approval_decision ?? null,
    approval_failure_code: input.approval_failure_code ?? null,
    approval_id: input.approval_id ?? null,
    approval_required: input.approval_required ?? null,
    approval_status: input.approval_status ?? null,
    correlation_id: input.correlation_id,
    decision: input.decision,
    duration_ms: input.duration_ms,
    execution_outcome: input.execution_outcome ?? null,
    executor: input.executor ?? null,
    human_validation_id: input.human_validation_id ?? null,
    idempotency_key: input.idempotency_key ?? null,
    idempotency_key_hash: input.idempotency_key_hash ?? null,
    idempotency_status: input.idempotency_status ?? null,
    mode: input.mode,
    autonomy_maximum: input.autonomy.maximum,
    autonomy_requested: input.autonomy.requested,
    output_hash: input.output_hash ?? null,
    params_hash: input.params_hash ?? null,
    reason_code: input.reason_code,
    replayed: input.replayed ?? null,
    request_fingerprint: input.request_fingerprint ?? null,
    resource_id: input.resource?.resource_id ?? null,
    resource_kind: input.resource?.kind ?? null,
    resource_tenant_id: input.resource?.tenant_id ?? null,
    result: input.result,
    tenant_id: input.tenant.tenant_id,
    timestamp,
    tool_id: input.tool.tool_id,
    tool_version: input.tool.tool_version,
  });
}

function deriveAuditId(
  input: ParsedAuditBuildInput,
  timestamp: string,
): string {
  const digest = createHash("sha256")
    .update(canonicalForId(input, timestamp), "utf8")
    .digest("hex")
    .slice(0, 32);
  return `aud_${digest}`;
}

function assembleEvent(
  input: ParsedAuditBuildInput,
  context: ParsedAuditBuildContext,
): AuditEvent {
  const timestamp = context.now;
  const audit_id = input.audit_id ?? deriveAuditId(input, timestamp);

  const event: AuditEvent = {
    audit_id,
    timestamp,
    correlation_id: input.correlation_id,
    tenant: { tenant_id: input.tenant.tenant_id },
    actor: {
      actor_id: input.actor.actor_id,
      actor_type: input.actor.actor_type,
    },
    tool: {
      tool_id: input.tool.tool_id,
      tool_version: input.tool.tool_version,
    },
    mode: input.mode,
    autonomy: {
      requested: input.autonomy.requested,
      maximum: input.autonomy.maximum,
    },
    decision: input.decision,
    result: input.result,
    reason_code: input.reason_code,
    duration_ms: input.duration_ms,
    params_hash: input.params_hash ?? null,
    executor: input.executor ?? null,
  };

  if (input.resource) {
    event.resource = copyResource(input.resource);
  }
  if (input.output_hash !== undefined) {
    event.output_hash = input.output_hash;
  }
  if (input.human_validation_id !== undefined) {
    event.human_validation_id = input.human_validation_id;
  }
  if (input.idempotency_key !== undefined) {
    event.idempotency_key = input.idempotency_key;
  }
  if (input.idempotency_key_hash !== undefined) {
    event.idempotency_key_hash = input.idempotency_key_hash;
  }
  if (input.idempotency_status !== undefined) {
    event.idempotency_status = input.idempotency_status;
  }
  if (input.replayed !== undefined) {
    event.replayed = input.replayed;
  }
  if (input.request_fingerprint !== undefined) {
    event.request_fingerprint = input.request_fingerprint;
  }
  if (input.execution_outcome !== undefined) {
    event.execution_outcome = input.execution_outcome;
  }
  if (input.approval_id !== undefined) {
    event.approval_id = input.approval_id;
  }
  if (input.approval_status !== undefined) {
    event.approval_status = input.approval_status;
  }
  if (input.approval_required !== undefined) {
    event.approval_required = input.approval_required;
  }
  if (input.approval_consumed !== undefined) {
    event.approval_consumed = input.approval_consumed;
  }
  if (input.approval_decision !== undefined) {
    event.approval_decision = input.approval_decision;
  }
  if (input.approval_failure_code !== undefined) {
    event.approval_failure_code = input.approval_failure_code;
  }

  return event;
}

/**
 * Parse + assemble. Lève AuditBuildError si entrée/contexte invalides.
 * Ne mute jamais `input` / `context`.
 */
export function buildAuditEvent(
  input: unknown,
  context: unknown,
): AuditEvent {
  const contextParsed = auditBuildContextSchema.safeParse(context);
  if (!contextParsed.success) {
    throw new AuditBuildError(
      "AUDIT_CONTEXT_INVALID",
      "Contexte d’audit invalide : horloge injectée (now) requise.",
    );
  }

  const inputParsed = auditBuildInputSchema.safeParse(input);
  if (!inputParsed.success) {
    throw new AuditBuildError(
      "AUDIT_INPUT_INVALID",
      "Entrée d’audit invalide ou champs interdits (schéma strict).",
    );
  }

  return assembleEvent(inputParsed.data, contextParsed.data);
}

/** Empreinte déterministe exportée pour tests / appelants (pas de secrets). */
export function deriveDeterministicAuditId(
  input: ParsedAuditBuildInput,
  timestamp: string,
): string {
  return deriveAuditId(input, timestamp);
}
