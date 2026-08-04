/**
 * Assertions de sécurité / mapping pour tests G1-F.
 */

import { expect } from "vitest";

import type { AgentAuditEventInsert } from "@/lib/agent/audit/persistence";
import type { AuditEvent } from "@/lib/agent/audit";

import {
  RAW_SQL_DETAIL,
  SENSITIVE_CARD_PAN,
  SENSITIVE_RAW_TOKEN,
  SENSITIVE_STACK_FRAGMENT,
} from "./constants";

export function expectNoSensitiveLeak(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(SENSITIVE_RAW_TOKEN);
  expect(serialized).not.toContain("sk_live_");
  expect(serialized).not.toContain(SENSITIVE_CARD_PAN);
  expect(serialized).not.toContain("4111111111111111");
  expect(serialized).not.toMatch(/"stack"\s*:/);
  expect(serialized).not.toContain(SENSITIVE_STACK_FRAGMENT);
  expect(serialized).not.toContain("at Object.");
  expect(serialized).not.toContain("\n    at ");
}

export function expectNoRawPayload(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toMatch(/"arguments"\s*:/);
  expect(serialized).not.toMatch(/"payload"\s*:/);
  expect(serialized).not.toMatch(/"raw_output"\s*:/);
  expect(serialized).not.toMatch(/"secret"\s*:/);
  expect(serialized).not.toMatch(/"token"\s*:/);
  // output métier brut interdit ; output_hash autorisé.
  expect(serialized).not.toMatch(/"output"\s*:\s*\{/);
}

export function expectNoRawSqlLeak(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(RAW_SQL_DETAIL);
  expect(serialized).not.toContain("duplicate key value");
  expect(serialized).not.toContain("violates unique constraint");
  expect(serialized).not.toContain("agent_audit_events_pkey");
  expect(serialized).not.toMatch(/DETAIL:/i);
  expect(serialized).not.toMatch(/HINT:/i);
}

/** Vérifie le mapping colonnes autorisées (hors recorded_at). */
export function expectMappedColumns(
  row: AgentAuditEventInsert,
  event: AuditEvent,
): void {
  expect(row).not.toHaveProperty("recorded_at");
  expect(row.audit_id).toBe(event.audit_id);
  expect(row.occurred_at).toBe(event.timestamp);
  expect(row.correlation_id).toBe(event.correlation_id);
  expect(row.tenant_id).toBe(event.tenant.tenant_id);
  expect(row.actor_id).toBe(event.actor.actor_id);
  expect(row.actor_type).toBe(event.actor.actor_type);
  expect(row.tool_id).toBe(event.tool.tool_id);
  expect(row.tool_version).toBe(event.tool.tool_version);
  expect(row.mode).toBe(event.mode);
  expect(row.requested_autonomy_level).toBe(event.autonomy.requested);
  expect(row.decision).toBe(event.decision);
  expect(row.result_status).toBe(event.result);
  expect(row.reason_code).toBe(event.reason_code);
  expect(row.resource_kind).toBe(event.resource?.kind ?? null);
  expect(row.resource_id).toBe(event.resource?.resource_id ?? null);
  expect(row.params_hash).toBe(event.params_hash);
  expect(row.output_hash).toBe(event.output_hash ?? null);
  expect(row.executor_id).toBe(event.executor);
  expect(row.event_payload.audit_id).toBe(event.audit_id);
  expect(row.event_payload.params_hash).toBe(event.params_hash);
  expectNoRawPayload(row);
  expectNoSensitiveLeak(row);
}
