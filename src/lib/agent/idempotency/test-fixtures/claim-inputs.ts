/**
 * Entrées claim / complete / fail pour tests service G1-G.
 */

import type {
  IdempotencyClaimInput,
  IdempotencyCompleteInput,
  IdempotencyFailInput,
  IdempotencyTerminalResult,
} from "@/lib/agent/idempotency";

import {
  CORRELATION_ID,
  FINGERPRINT_A,
  FINGERPRINT_B,
  FIXED_NOW,
  IDEMPOTENCY_KEY,
  INVOICE_1,
  OUTPUT_HASH,
  TENANT_A_UUID,
  TTL_SECONDS,
} from "./constants";

export function successTerminal(
  overrides: Partial<Extract<IdempotencyTerminalResult, { status: "success" }>> = {},
): IdempotencyTerminalResult {
  return {
    status: "success",
    output_hash: OUTPUT_HASH,
    summary: { tool: "invoice.get", ok: true },
    ...overrides,
  };
}

export function failureTerminal(
  overrides: Partial<
    Extract<IdempotencyTerminalResult, { status: "failure" }>
  > = {},
): IdempotencyTerminalResult {
  return {
    status: "failure",
    failure_code: "EXECUTOR_BUSINESS_ERROR",
    message: "Échec métier sanitizé",
    ...overrides,
  };
}

export function baseClaimInput(
  overrides: Partial<IdempotencyClaimInput> = {},
): IdempotencyClaimInput {
  return {
    tenant_id: TENANT_A_UUID,
    idempotency_key: IDEMPOTENCY_KEY,
    correlation_id: CORRELATION_ID,
    tool_id: "invoice.get",
    tool_version: "1.0.0",
    mode: "agir",
    resource: {
      kind: "invoice",
      resource_id: INVOICE_1,
      tenant_id: TENANT_A_UUID,
    },
    request_fingerprint: FINGERPRINT_A,
    now: FIXED_NOW,
    ttl_seconds: TTL_SECONDS,
    ...overrides,
  };
}

export function conflictClaimInput(): IdempotencyClaimInput {
  return baseClaimInput({
    request_fingerprint: FINGERPRINT_B,
  });
}

export function completeInput(
  recordId: string,
  ownerToken: string,
  overrides: Partial<IdempotencyCompleteInput> = {},
): IdempotencyCompleteInput {
  return {
    record_id: recordId,
    owner_token: ownerToken,
    terminal_result: successTerminal(),
    now: FIXED_NOW,
    ...overrides,
  };
}

export function failInput(
  recordId: string,
  ownerToken: string,
  overrides: Partial<IdempotencyFailInput> = {},
): IdempotencyFailInput {
  return {
    record_id: recordId,
    owner_token: ownerToken,
    failure_code: "EXECUTOR_TECHNICAL_ERROR",
    terminal_result: failureTerminal({
      failure_code: "EXECUTOR_TECHNICAL_ERROR",
      message: "Erreur technique sanitizée",
    }),
    now: FIXED_NOW,
    ...overrides,
  };
}
