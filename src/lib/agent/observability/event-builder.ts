/**
 * Construction pure d’un ObservabilityEvent (G1-I).
 * Déterministe : mêmes entrées → même événement (y compris event_id si omis).
 * Aucune I/O, aucune horloge globale (utilise `input.now`), aucune mutation.
 */

import { createHash } from "node:crypto";

import {
  observabilityEventSchema,
  observabilityRecordInputSchema,
  type ParsedObservabilityRecordInput,
} from "./schemas";
import {
  OBSERVABILITY_SCHEMA_VERSION,
  ObservabilityError,
  type ObservabilityEvent,
  type ObservabilityMetadata,
} from "./types";
import { OBSERVABILITY_SAFE_MESSAGES } from "./reason-codes";

function copyMetadata(
  metadata: ObservabilityMetadata | undefined,
): ObservabilityMetadata | undefined {
  if (metadata === undefined) {
    return undefined;
  }
  return { ...metadata };
}

/**
 * Canonicalisation stable pour empreinte — clés ordonnées, pas de payload.
 */
function canonicalForId(input: ParsedObservabilityRecordInput): string {
  return JSON.stringify({
    approval_consumed: input.approval_consumed ?? null,
    approval_required: input.approval_required ?? null,
    approval_status: input.approval_status ?? null,
    autonomy_level: input.autonomy_level ?? null,
    component: input.component,
    correlation_id: input.correlation_id,
    duration_ms: input.duration_ms ?? null,
    error_code: input.error_code ?? null,
    execution_outcome: input.execution_outcome ?? null,
    idempotency_status: input.idempotency_status ?? null,
    metadata: input.metadata ?? null,
    mode: input.mode ?? null,
    now: input.now,
    operation: input.operation,
    outcome: input.outcome,
    reason_code: input.reason_code ?? null,
    replayed: input.replayed ?? null,
    resource_kind: input.resource_kind ?? null,
    severity: input.severity,
    tenant_id: input.tenant_id,
    tool_id: input.tool_id ?? null,
    tool_version: input.tool_version ?? null,
  });
}

function deriveEventId(input: ParsedObservabilityRecordInput): string {
  const digest = createHash("sha256")
    .update(canonicalForId(input), "utf8")
    .digest("hex")
    .slice(0, 32);
  return `obs_${digest}`;
}

function assembleEvent(
  input: ParsedObservabilityRecordInput,
): ObservabilityEvent {
  const event: ObservabilityEvent = {
    event_id: input.event_id ?? deriveEventId(input),
    schema_version: OBSERVABILITY_SCHEMA_VERSION,
    occurred_at: input.now,
    correlation_id: input.correlation_id,
    tenant_id: input.tenant_id,
    component: input.component,
    operation: input.operation,
    outcome: input.outcome,
    severity: input.severity,
  };

  if (input.duration_ms !== undefined) {
    event.duration_ms = input.duration_ms;
  }
  if (input.tool_id !== undefined) {
    event.tool_id = input.tool_id;
  }
  if (input.tool_version !== undefined) {
    event.tool_version = input.tool_version;
  }
  if (input.mode !== undefined) {
    event.mode = input.mode;
  }
  if (input.autonomy_level !== undefined) {
    event.autonomy_level = input.autonomy_level;
  }
  if (input.resource_kind !== undefined) {
    event.resource_kind = input.resource_kind;
  }
  if (input.reason_code !== undefined) {
    event.reason_code = input.reason_code;
  }
  if (input.error_code !== undefined) {
    event.error_code = input.error_code;
  }
  if (input.idempotency_status !== undefined) {
    event.idempotency_status = input.idempotency_status;
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
  if (input.replayed !== undefined) {
    event.replayed = input.replayed;
  }
  if (input.execution_outcome !== undefined) {
    event.execution_outcome = input.execution_outcome;
  }
  const metadata = copyMetadata(input.metadata);
  if (metadata !== undefined) {
    event.metadata = metadata;
  }

  return event;
}

/**
 * Parse + assemble. Lève ObservabilityError si entrée invalide.
 * Ne mute jamais `input`.
 */
export function buildObservabilityEvent(input: unknown): ObservabilityEvent {
  const parsed = observabilityRecordInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ObservabilityError(
      "OBSERVABILITY_INPUT_INVALID",
      OBSERVABILITY_SAFE_MESSAGES.OBSERVABILITY_INPUT_INVALID,
    );
  }

  const event = assembleEvent(parsed.data);

  const validated = observabilityEventSchema.safeParse(event);
  if (!validated.success) {
    throw new ObservabilityError(
      "EVENT_BUILD_FAILED",
      OBSERVABILITY_SAFE_MESSAGES.EVENT_BUILD_FAILED,
    );
  }

  return event;
}

/** Empreinte déterministe exportée pour tests / appelants (pas de secrets). */
export function deriveDeterministicEventId(
  input: ParsedObservabilityRecordInput,
): string {
  return deriveEventId(input);
}
