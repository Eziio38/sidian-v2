/**
 * Événements AuditEvent valides pour tests G1-F (via Audit Service G1-E).
 */

import {
  createAuditService,
  type AuditEvent,
} from "@/lib/agent/audit";

import {
  ACTOR_ID,
  CORRELATION_ID,
  EXECUTOR_ID,
  FIXED_NOW,
  HUMAN_VALIDATION_ID,
  IDEMPOTENCY_KEY,
  INVOICE_1,
  OUTPUT_HASH,
  PARAMS_HASH,
  TENANT_A_UUID,
} from "./constants";

const audit = createAuditService();

export function successAuditEvent(
  overrides: Partial<AuditEvent> = {},
): AuditEvent {
  const built = audit.build(
    {
      correlation_id: CORRELATION_ID,
      tenant: { tenant_id: TENANT_A_UUID },
      actor: { actor_id: ACTOR_ID, actor_type: "human" },
      tool: { tool_id: "invoice.get", tool_version: "1.0.0" },
      mode: "agir",
      autonomy: { requested: 1, maximum: 1 },
      decision: "allow",
      result: "success",
      reason_code: "SUCCESS",
      duration_ms: 12,
      resource: {
        kind: "invoice",
        resource_id: INVOICE_1,
        tenant_id: TENANT_A_UUID,
      },
      params_hash: PARAMS_HASH,
      executor: EXECUTOR_ID,
      output_hash: OUTPUT_HASH,
      idempotency_key: IDEMPOTENCY_KEY,
    },
    { now: FIXED_NOW },
  );

  return { ...built, ...overrides };
}

export function approvalAuditEvent(
  overrides: Partial<AuditEvent> = {},
): AuditEvent {
  const built = audit.build(
    {
      correlation_id: CORRELATION_ID,
      tenant: { tenant_id: TENANT_A_UUID },
      actor: { actor_id: ACTOR_ID, actor_type: "human" },
      tool: { tool_id: "payment.create_attempt", tool_version: "1.0.0" },
      mode: "agir",
      autonomy: { requested: 2, maximum: 2 },
      decision: "require_approval",
      result: "approval_required",
      reason_code: "VALIDATION_REQUIRED",
      duration_ms: 4,
      resource: {
        kind: "invoice",
        resource_id: INVOICE_1,
        tenant_id: TENANT_A_UUID,
      },
      params_hash: PARAMS_HASH,
      executor: null,
      human_validation_id: HUMAN_VALIDATION_ID,
    },
    { now: FIXED_NOW },
  );

  return { ...built, ...overrides };
}
