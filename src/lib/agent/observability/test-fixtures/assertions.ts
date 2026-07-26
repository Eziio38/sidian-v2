/**
 * Helpers d’assertion G1-I — Observability (contrat production).
 */

import { expect } from "vitest";

import type {
  MetricPoint,
  ObservabilityEvent,
  SecuritySignal,
} from "@/lib/agent/observability";

import {
  FULL_ARGUMENTS_PAYLOAD,
  RAW_SQL_DETAIL,
  SENSITIVE_CARD_PAN,
  SENSITIVE_RAW_FIELD,
  SENSITIVE_RAW_TOKEN,
  SENSITIVE_STACK_FRAGMENT,
  TENANT_B,
} from "./constants";

export function expectNoSensitiveLeak(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(SENSITIVE_RAW_TOKEN);
  expect(serialized).not.toContain("sk_live_");
  expect(serialized).not.toContain(SENSITIVE_RAW_FIELD);
  expect(serialized).not.toContain(SENSITIVE_CARD_PAN);
  expect(serialized).not.toContain("4111111111111111");
  expect(serialized).not.toMatch(/"stack"\s*:/);
  expect(serialized).not.toContain(SENSITIVE_STACK_FRAGMENT);
  expect(serialized).not.toContain("at Object.");
  expect(serialized).not.toContain("at async");
  expect(serialized).not.toContain("\n    at ");
}

export function expectNoRawPayload(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toMatch(/"arguments"\s*:/);
  expect(serialized).not.toMatch(/"payload"\s*:/);
  expect(serialized).not.toMatch(/"raw_output"\s*:/);
  expect(serialized).not.toMatch(/"secret"\s*:/);
  expect(serialized).not.toMatch(/"api_key"\s*:/);
  expect(serialized).not.toMatch(/"owner_token"\s*:/);
  expect(serialized).not.toMatch(/"idempotency_key"\s*:/);
  expect(serialized).not.toContain(JSON.stringify(FULL_ARGUMENTS_PAYLOAD));
}

export function expectNoRawSqlLeak(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(RAW_SQL_DETAIL);
  expect(serialized).not.toContain("duplicate key value");
  expect(serialized).not.toContain("violates unique constraint");
  expect(serialized).not.toMatch(/DETAIL:/i);
  expect(serialized).not.toMatch(/HINT:/i);
}

export function expectStableEventCore(
  a: ObservabilityEvent,
  b: ObservabilityEvent,
): void {
  expect(a.event_id).toBe(b.event_id);
  expect(a.schema_version).toBe(b.schema_version);
  expect(a.occurred_at).toBe(b.occurred_at);
  expect(a.correlation_id).toBe(b.correlation_id);
  expect(a.tenant_id).toBe(b.tenant_id);
  expect(a.component).toBe(b.component);
  expect(a.operation).toBe(b.operation);
  expect(a.outcome).toBe(b.outcome);
  expect(a.severity).toBe(b.severity);
  expect(a.duration_ms).toBe(b.duration_ms);
  expect(a.tool_id).toBe(b.tool_id);
  expect(a.tool_version).toBe(b.tool_version);
  expect(a.mode).toBe(b.mode);
  expect(a.autonomy_level).toBe(b.autonomy_level);
  expect(a.resource_kind).toBe(b.resource_kind);
  expect(a.reason_code).toBe(b.reason_code);
  expect(a.error_code).toBe(b.error_code);
  expect(a.idempotency_status).toBe(b.idempotency_status);
  expect(a.approval_status).toBe(b.approval_status);
  expect(a.replayed).toBe(b.replayed);
  expect(a.execution_outcome).toBe(b.execution_outcome);
  expect(a.metadata).toEqual(b.metadata);
}

export function expectMetricValue(
  metrics: readonly MetricPoint[],
  name: MetricPoint["name"],
  value: number,
): void {
  const point = metrics.find((m) => m.name === name);
  expect(point, `métrique ${name} absente`).toBeDefined();
  expect(point?.value).toBe(value);
}

export function expectEvidenceIdsOnly(signal: SecuritySignal): void {
  expect(signal.evidence_event_ids.length).toBeGreaterThan(0);
  for (const id of signal.evidence_event_ids) {
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  }
  const serialized = JSON.stringify(signal);
  expect(serialized).not.toMatch(/"arguments"\s*:/);
  expect(serialized).not.toMatch(/"payload"\s*:/);
  expect(serialized).not.toMatch(/"output"\s*:/);
  expectNoSensitiveLeak(signal);
}

export function expectNoNeighborTenantLeak(
  signal: SecuritySignal,
  ownTenant: string,
): void {
  expect(signal.tenant_id).toBe(ownTenant);
  expect(signal.tenant_id).not.toBe(TENANT_B);
  const serialized = JSON.stringify(signal);
  if (ownTenant !== TENANT_B) {
    expect(serialized).not.toContain(`"tenant_id":"${TENANT_B}"`);
  }
}
