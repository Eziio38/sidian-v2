/**
 * Fixtures d’entrée AuditBuildInput (mémoire, zéro I/O).
 */

import type {
  AuditBuildContext,
  AuditBuildInput,
  AuditResource,
} from "@/lib/agent/audit";

import {
  ACTOR_ID,
  CORRELATION_ID,
  EXECUTOR_ID,
  FIXED_NOW,
  HUMAN_VALIDATION_ID,
  IDEMPOTENCY_KEY,
  INVOICE_1,
  OUTPUT_HASH_V1,
  PARAMS_HASH_V1,
  TENANT_A,
} from "./constants";

export const invoiceResource: AuditResource = {
  kind: "invoice",
  resource_id: INVOICE_1,
  tenant_id: TENANT_A,
};

export function auditContext(
  overrides: Partial<AuditBuildContext> = {},
): AuditBuildContext {
  return {
    now: FIXED_NOW,
    ...overrides,
  };
}

/** Base commune — champs stables pour tous les scénarios. */
export function baseAuditInput(
  overrides: Partial<AuditBuildInput> = {},
): AuditBuildInput {
  return {
    correlation_id: CORRELATION_ID,
    tenant: { tenant_id: TENANT_A },
    actor: { actor_id: ACTOR_ID, actor_type: "human" },
    tool: { tool_id: "invoice.get", tool_version: "1.0.0" },
    mode: "agir",
    autonomy: { requested: 1, maximum: 1 },
    decision: "allow",
    result: "success",
    reason_code: "SUCCESS",
    duration_ms: 12,
    resource: { ...invoiceResource },
    params_hash: PARAMS_HASH_V1,
    executor: null,
    ...overrides,
  };
}

/** EVAL-TOOL-022 / EVAL-OBS-002 — succès tool-call audité. */
export function successBuildInput(
  overrides: Partial<AuditBuildInput> = {},
): AuditBuildInput {
  return baseAuditInput({
    decision: "allow",
    result: "success",
    reason_code: "SUCCESS",
    executor: EXECUTOR_ID,
    output_hash: OUTPUT_HASH_V1,
    human_validation_id: undefined,
    idempotency_key: IDEMPOTENCY_KEY,
    ...overrides,
  });
}

/** Deny permission — EXECUTOR jamais invoqué. */
export function denyBuildInput(
  overrides: Partial<AuditBuildInput> = {},
): AuditBuildInput {
  return baseAuditInput({
    tool: { tool_id: "payment.create_attempt", tool_version: "1.0.0" },
    autonomy: { requested: 2, maximum: 2 },
    decision: "deny",
    result: "denied",
    reason_code: "PERMISSION_MISSING",
    executor: null,
    output_hash: undefined,
    ...overrides,
  });
}

/** require_approval — VALIDATION_REQUIRED. */
export function approvalBuildInput(
  overrides: Partial<AuditBuildInput> = {},
): AuditBuildInput {
  return baseAuditInput({
    tool: { tool_id: "payment.create_attempt", tool_version: "1.0.0" },
    autonomy: { requested: 2, maximum: 2 },
    decision: "require_approval",
    result: "approval_required",
    reason_code: "VALIDATION_REQUIRED",
    executor: null,
    human_validation_id: HUMAN_VALIDATION_ID,
    output_hash: undefined,
    ...overrides,
  });
}

/** Erreur validation arguments (Router INVALID_ARGUMENT) — permission non évaluée. */
export function validationErrorBuildInput(
  overrides: Partial<AuditBuildInput> = {},
): AuditBuildInput {
  return baseAuditInput({
    tool: { tool_id: "payment.create_attempt", tool_version: "1.0.0" },
    autonomy: { requested: 2, maximum: null },
    decision: "none",
    result: "validation_error",
    reason_code: "INVALID_ARGUMENT",
    executor: null,
    output_hash: undefined,
    ...overrides,
  });
}

/** Erreur métier exécuteur. */
export function businessErrorBuildInput(
  overrides: Partial<AuditBuildInput> = {},
): AuditBuildInput {
  return baseAuditInput({
    decision: "allow",
    result: "business_error",
    reason_code: "EXECUTOR_BUSINESS_ERROR",
    executor: EXECUTOR_ID,
    output_hash: undefined,
    ...overrides,
  });
}

/** Erreur technique exécuteur / interne. */
export function technicalErrorBuildInput(
  overrides: Partial<AuditBuildInput> = {},
): AuditBuildInput {
  return baseAuditInput({
    decision: "allow",
    result: "technical_error",
    reason_code: "EXECUTOR_TECHNICAL_ERROR",
    executor: EXECUTOR_ID,
    output_hash: undefined,
    ...overrides,
  });
}
