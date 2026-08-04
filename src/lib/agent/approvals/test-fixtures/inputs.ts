/**
 * Entrées request / decide / inspect / consume pour tests service G1-H.
 */

import type {
  ApprovalConsumptionInput,
  ApprovalDecisionInput,
  ApprovalInspectionInput,
  ApprovalRequestInput,
} from "@/lib/agent/approvals";

import {
  CORRELATION_ID,
  DECIDER_ACTOR_ID,
  FINGERPRINT_A,
  FINGERPRINT_B,
  FIXED_EXPIRES_AT,
  FIXED_NOW,
  IDEMPOTENCY_KEY_HASH,
  INVOICE_1,
  PARAMS_HASH,
  PARAMS_HASH_B,
  REASON_CODE_APPROVE,
  REASON_CODE_REJECT,
  REQUESTER_ACTOR_ID,
  TENANT_A_UUID,
  TENANT_B_UUID,
  TTL_SECONDS,
} from "./constants";

export function baseRequestInput(
  overrides: Partial<ApprovalRequestInput> = {},
): ApprovalRequestInput {
  return {
    tenant_id: TENANT_A_UUID,
    request_fingerprint: FINGERPRINT_A,
    params_hash: PARAMS_HASH,
    tool_id: "invoice.send_reminder",
    tool_version: "1.0.0",
    mode: "agir",
    requested_autonomy_level: 2,
    resource: {
      kind: "invoice",
      resource_id: INVOICE_1,
      tenant_id: TENANT_A_UUID,
    },
    requester_actor: {
      actor_id: REQUESTER_ACTOR_ID,
      actor_type: "system",
    },
    now: FIXED_NOW,
    expires_at: FIXED_EXPIRES_AT,
    ...overrides,
  };
}

export function requestWithTtl(
  overrides: Partial<ApprovalRequestInput> = {},
): ApprovalRequestInput {
  const base = baseRequestInput();
  const { expires_at: _drop, ...withoutExpiry } = base;
  void _drop;
  return {
    ...withoutExpiry,
    ttl_seconds: TTL_SECONDS,
    ...overrides,
  };
}

export function approveDecisionInput(
  approvalId: string,
  overrides: Partial<ApprovalDecisionInput> = {},
): ApprovalDecisionInput {
  return {
    approval_id: approvalId,
    tenant_id: TENANT_A_UUID,
    decision: "approve",
    decided_by_actor_id: DECIDER_ACTOR_ID,
    reason_code: REASON_CODE_APPROVE,
    now: FIXED_NOW,
    ...overrides,
  };
}

export function rejectDecisionInput(
  approvalId: string,
  overrides: Partial<ApprovalDecisionInput> = {},
): ApprovalDecisionInput {
  return approveDecisionInput(approvalId, {
    decision: "reject",
    reason_code: REASON_CODE_REJECT,
    ...overrides,
  });
}

export function inspectInput(
  approvalId: string,
  overrides: Partial<ApprovalInspectionInput> = {},
): ApprovalInspectionInput {
  return {
    approval_id: approvalId,
    tenant_id: TENANT_A_UUID,
    now: FIXED_NOW,
    ...overrides,
  };
}

export function baseConsumeInput(
  approvalId: string,
  overrides: Partial<ApprovalConsumptionInput> = {},
): ApprovalConsumptionInput {
  return {
    approval_id: approvalId,
    tenant_id: TENANT_A_UUID,
    request_fingerprint: FINGERPRINT_A,
    params_hash: PARAMS_HASH,
    tool_id: "invoice.send_reminder",
    tool_version: "1.0.0",
    mode: "agir",
    requested_autonomy_level: 2,
    resource: {
      kind: "invoice",
      resource_id: INVOICE_1,
      tenant_id: TENANT_A_UUID,
    },
    correlation_id: CORRELATION_ID,
    idempotency_key_hash: IDEMPOTENCY_KEY_HASH,
    now: FIXED_NOW,
    ...overrides,
  };
}

export function fingerprintMismatchConsume(
  approvalId: string,
): ApprovalConsumptionInput {
  return baseConsumeInput(approvalId, {
    request_fingerprint: FINGERPRINT_B,
  });
}

export function paramsMismatchConsume(
  approvalId: string,
): ApprovalConsumptionInput {
  return baseConsumeInput(approvalId, {
    params_hash: PARAMS_HASH_B,
  });
}

export function crossTenantConsume(
  approvalId: string,
): ApprovalConsumptionInput {
  return baseConsumeInput(approvalId, {
    tenant_id: TENANT_B_UUID,
  });
}
