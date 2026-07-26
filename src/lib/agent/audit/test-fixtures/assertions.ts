/**
 * Helpers d’assertion sur AuditEvent (contrat production G1-E).
 */

import { expect } from "vitest";

import type { AuditEvent, AuditResultKind } from "@/lib/agent/audit";

import {
  SENSITIVE_CARD_PAN,
  SENSITIVE_RAW_FIELD,
  SENSITIVE_RAW_TOKEN,
  SENSITIVE_STACK_FRAGMENT,
} from "./constants";

/** Alias local pour lisibilité des assertions. */
export type AuditEventLike = AuditEvent;

export function expectAuditResult(
  event: AuditEventLike,
  result: AuditResultKind,
): void {
  expect(event.result).toBe(result);
}

/** Vérifie qu’aucun secret / stack / payload brut sensible n’est exposé. */
export function expectNoSensitiveLeak(event: unknown): void {
  const serialized = JSON.stringify(event);
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

/** Vérifie l’absence de payload / arguments / sortie brute. */
export function expectNoRawPayload(event: unknown): void {
  const serialized = JSON.stringify(event);
  expect(serialized).not.toMatch(/"arguments"\s*:/);
  expect(serialized).not.toMatch(/"payload"\s*:/);
  expect(serialized).not.toMatch(/"output"\s*:/);
  expect(serialized).not.toMatch(/"raw_output"\s*:/);
  expect(serialized).not.toMatch(/"secret"\s*:/);
  expect(serialized).not.toMatch(/"token"\s*:/);
}

export function expectStableCoreFields(
  a: AuditEventLike,
  b: AuditEventLike,
): void {
  expect(a.audit_id).toBe(b.audit_id);
  expect(a.timestamp).toBe(b.timestamp);
  expect(a.correlation_id).toBe(b.correlation_id);
  expect(a.tenant).toEqual(b.tenant);
  expect(a.actor).toEqual(b.actor);
  expect(a.tool).toEqual(b.tool);
  expect(a.mode).toBe(b.mode);
  expect(a.autonomy).toEqual(b.autonomy);
  expect(a.decision).toBe(b.decision);
  expect(a.result).toBe(b.result);
  expect(a.reason_code).toBe(b.reason_code);
  expect(a.duration_ms).toBe(b.duration_ms);
  expect(a.params_hash).toBe(b.params_hash);
  expect(a.executor).toBe(b.executor);
  expect(a.output_hash).toBe(b.output_hash);
  expect(a.resource).toEqual(b.resource);
  expect(a.human_validation_id).toBe(b.human_validation_id);
  expect(a.idempotency_key).toBe(b.idempotency_key);
  expect(a.idempotency_key_hash).toBe(b.idempotency_key_hash);
  expect(a.idempotency_status).toBe(b.idempotency_status);
  expect(a.replayed).toBe(b.replayed);
  expect(a.request_fingerprint).toBe(b.request_fingerprint);
  expect(a.execution_outcome).toBe(b.execution_outcome);
  expect(a.approval_id).toBe(b.approval_id);
  expect(a.approval_status).toBe(b.approval_status);
  expect(a.approval_required).toBe(b.approval_required);
  expect(a.approval_consumed).toBe(b.approval_consumed);
  expect(a.approval_decision).toBe(b.approval_decision);
  expect(a.approval_failure_code).toBe(b.approval_failure_code);
}
