/**
 * Sources d’empreinte pour tests fingerprint G1-G.
 */

import type { IdempotencyFingerprintSource } from "@/lib/agent/idempotency";

import {
  INVOICE_1,
  INVOICE_2,
  PARAMS_HASH,
  TENANT_A_UUID,
  TENANT_B_UUID,
} from "./constants";

export function baseFingerprintSource(
  overrides: Partial<IdempotencyFingerprintSource> = {},
): IdempotencyFingerprintSource {
  return {
    tenant_id: TENANT_A_UUID,
    tool_id: "invoice.get",
    tool_version: "1.0.0",
    mode: "agir",
    requested_autonomy_level: 1,
    resource: {
      kind: "invoice",
      resource_id: INVOICE_1,
      tenant_id: TENANT_A_UUID,
    },
    arguments: {
      invoice_id: INVOICE_1,
      include_lines: true,
    },
    current_params_hash: PARAMS_HASH,
    ...overrides,
  };
}

/** Même intention logique, clés JSON dans un ordre différent. */
export function reorderedArgumentsSource(): IdempotencyFingerprintSource {
  return baseFingerprintSource({
    arguments: {
      include_lines: true,
      invoice_id: INVOICE_1,
    },
  });
}

export function differentArgumentSource(): IdempotencyFingerprintSource {
  return baseFingerprintSource({
    arguments: {
      invoice_id: INVOICE_1,
      include_lines: false,
    },
  });
}

export function differentTenantSource(): IdempotencyFingerprintSource {
  return baseFingerprintSource({
    tenant_id: TENANT_B_UUID,
    resource: {
      kind: "invoice",
      resource_id: INVOICE_1,
      tenant_id: TENANT_B_UUID,
    },
  });
}

export function differentToolVersionSource(): IdempotencyFingerprintSource {
  return baseFingerprintSource({
    tool_version: "1.0.1",
  });
}

export function differentResourceSource(): IdempotencyFingerprintSource {
  return baseFingerprintSource({
    resource: {
      kind: "invoice",
      resource_id: INVOICE_2,
      tenant_id: TENANT_A_UUID,
    },
    arguments: {
      invoice_id: INVOICE_2,
      include_lines: true,
    },
  });
}
