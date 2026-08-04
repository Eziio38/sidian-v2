/**
 * Assertions de sécurité pour tests G1-K Gateway.
 */

import { expect } from "vitest";

import type { TrustedExecutionContext } from "@/lib/agent/gateway";

import {
  FULL_ARGUMENTS_PAYLOAD,
  RAW_AUTH_PROVIDER_DETAIL,
  SENSITIVE_RAW_JWT,
  SENSITIVE_RAW_TOKEN,
  SENSITIVE_STACK_FRAGMENT,
} from "./constants";

export function expectNoSensitiveLeak(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(SENSITIVE_RAW_TOKEN);
  expect(serialized).not.toContain("sk_live_");
  expect(serialized).not.toContain(SENSITIVE_RAW_JWT);
  expect(serialized).not.toContain("g1k_SENSITIVE_JWT_PAYLOAD");
  expect(serialized).not.toMatch(/"stack"\s*:/);
  expect(serialized).not.toContain(SENSITIVE_STACK_FRAGMENT);
  expect(serialized).not.toContain("at Object.");
  expect(serialized).not.toContain("\n    at ");
  expect(serialized).not.toContain(RAW_AUTH_PROVIDER_DETAIL);
  expect(serialized).not.toContain("AuthApiError");
  expect(serialized).not.toMatch(/DETAIL:/i);
}

export function expectNoJwtInContext(context: TrustedExecutionContext): void {
  const serialized = JSON.stringify(context);
  expect(serialized).not.toMatch(/"jwt"\s*:/);
  expect(serialized).not.toMatch(/"access_token"\s*:/);
  expect(serialized).not.toMatch(/"refresh_token"\s*:/);
  expect(serialized).not.toMatch(/"bearer_token"\s*:/);
  expect(serialized).not.toMatch(/"authorization"\s*:/);
  expect(serialized).not.toMatch(/"cookie"\s*:/);
  expect(serialized).not.toMatch(/"claims"\s*:/);
  expect(serialized).not.toMatch(/"raw_claims"\s*:/);
  expect(serialized).not.toContain(SENSITIVE_RAW_JWT);
  expect(serialized).not.toContain("eyJhbGciOi");
}

export function expectNoTokenInAuditPayload(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toMatch(/"bearer_token"\s*:/);
  expect(serialized).not.toMatch(/"access_token"\s*:/);
  expect(serialized).not.toMatch(/"refresh_token"\s*:/);
  expect(serialized).not.toMatch(/"authorization"\s*:/);
  expect(serialized).not.toContain(SENSITIVE_RAW_JWT);
  expect(serialized).not.toContain("g1k.valid.bearer");
}

export function expectNoUselessClaims(context: TrustedExecutionContext): void {
  const keys = Object.keys(context);
  expect(keys).not.toContain("email");
  expect(keys).not.toContain("phone");
  expect(keys).not.toContain("app_metadata");
  expect(keys).not.toContain("user_metadata");
  expect(keys).not.toContain("aud");
  expect(keys).not.toContain("iss");
  expect(keys).not.toContain("role");
  expect(keys).not.toContain("aal");
  expect(keys).not.toContain("amr");
  expect(keys).not.toContain("session_id");
  expect(keys).not.toContain("provider_token");
}

export function expectNoRawArgumentsLeak(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(JSON.stringify(FULL_ARGUMENTS_PAYLOAD));
  expect(serialized).not.toContain("FR761234567890");
}
