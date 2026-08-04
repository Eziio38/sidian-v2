/**
 * Assertions de sécurité pour tests G1-G.
 */

import { expect } from "vitest";

import {
  OWNER_TOKEN_A,
  OWNER_TOKEN_B,
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
  expect(serialized).not.toMatch(/"api_key"\s*:/);
  expect(serialized).not.toMatch(/"owner_token"\s*:/);
}

export function expectNoRawSqlLeak(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(RAW_SQL_DETAIL);
  expect(serialized).not.toContain("duplicate key value");
  expect(serialized).not.toContain("violates unique constraint");
  expect(serialized).not.toContain("agent_idempotency_records_tenant_key_uq");
  expect(serialized).not.toMatch(/DETAIL:/i);
  expect(serialized).not.toMatch(/HINT:/i);
}

/** Vérifie qu’un owner token brut n’est pas exposé hors décision acquired. */
export function expectNoOwnerTokenLeak(
  value: unknown,
  allowedTokens: string[] = [],
): void {
  const serialized = JSON.stringify(value);
  for (const token of [OWNER_TOKEN_A, OWNER_TOKEN_B]) {
    if (allowedTokens.includes(token)) continue;
    expect(serialized).not.toContain(token);
  }
  expect(serialized).not.toMatch(/"owner_token_hash"\s*:/);
}
