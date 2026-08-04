/**
 * Fixtures mémoire G1-C — jamais d’I/O.
 */

import type { ToolDefinition } from "@/lib/agent/tools/definition-schema";
import { invoiceGetV1 } from "@/lib/agent/tools/definitions/invoice.get.1.0.0";
import { paymentCreateAttemptV09 } from "@/lib/agent/tools/definitions/payment.create_attempt.0.9.0";
import { paymentCreateAttemptV1 } from "@/lib/agent/tools/definitions/payment.create_attempt.1.0.0";

import type {
  HumanValidationRecord,
  PermissionGrant,
  PermissionRequest,
  PermissionResource,
} from "../types";

export const FIXED_NOW = "2026-07-24T12:00:00.000Z";
export const TENANT_A = "tenant_a";
export const TENANT_B = "tenant_b";
export const INVOICE_1 = "inv_001";
export const INVOICE_2 = "inv_002";
export const PARAMS_HASH_V1 = "hash_params_v1";
export const PARAMS_HASH_V2 = "hash_params_v2";

export const invoiceResource: PermissionResource = {
  kind: "invoice",
  resource_id: INVOICE_1,
  tenant_id: TENANT_A,
};

export function baseReadRequest(
  overrides: Partial<PermissionRequest> = {},
): PermissionRequest {
  return {
    actor_id: "actor_1",
    actor_type: "human",
    tenant_id: TENANT_A,
    correlation_id: "corr_1",
    tool_id: "invoice.get",
    tool_version: "1.0.0",
    mode: "agir",
    requested_autonomy_level: 1,
    grants: [
      {
        permission: "invoice.read",
        tenant_id: TENANT_A,
      },
    ],
    resource: { ...invoiceResource },
    ...overrides,
  };
}

export function baseWriteRequest(
  overrides: Partial<PermissionRequest> = {},
): PermissionRequest {
  return {
    actor_id: "actor_1",
    actor_type: "human",
    tenant_id: TENANT_A,
    correlation_id: "corr_1",
    tool_id: "payment.create_attempt",
    tool_version: "1.0.0",
    mode: "agir",
    requested_autonomy_level: 2,
    grants: [
      {
        permission: "payment.execute",
        tenant_id: TENANT_A,
        resource_id: INVOICE_1,
      },
    ],
    resource: { ...invoiceResource },
    current_params_hash: PARAMS_HASH_V1,
    human_validation: approvedValidation(),
    ...overrides,
  };
}

export function approvedValidation(
  overrides: Partial<HumanValidationRecord> = {},
): HumanValidationRecord {
  return {
    validation_id: "val_001",
    status: "approved",
    expires_at: "2026-07-24T18:00:00.000Z",
    bound_tenant_id: TENANT_A,
    bound_tool_id: "payment.create_attempt",
    bound_tool_version: "1.0.0",
    bound_mode: "agir",
    bound_resource: { ...invoiceResource },
    bound_params_hash: PARAMS_HASH_V1,
    ...overrides,
  };
}

export const tenantGrant = (permission: string): PermissionGrant => ({
  permission,
  tenant_id: TENANT_A,
});

export const memoryDefinitions: ToolDefinition[] = [
  invoiceGetV1,
  paymentCreateAttemptV1,
  paymentCreateAttemptV09,
];

/** Outil Approved — connu mais non Production. */
export const approvedOnlyDefinition: ToolDefinition = {
  ...paymentCreateAttemptV1,
  tool_id: "fixture.approved_only",
  version: "1.0.0",
  status: "Approved",
};
