/**
 * Helpers d’assertion sur ToolRouteResult (contrat production G1-D).
 */

import { expect } from "vitest";

import type { ToolRouteResult } from "@/lib/agent/router";

import {
  SENSITIVE_RAW_FIELD,
  SENSITIVE_RAW_TOKEN,
} from "./constants";

/** Alias local pour lisibilité des assertions. */
export type ToolRouteResultLike = ToolRouteResult;

export function expectBlocked(
  result: ToolRouteResultLike,
  code: string,
): asserts result is Extract<ToolRouteResultLike, { status: "blocked" }> {
  expect(result.status).toBe("blocked");
  if (result.status === "blocked") {
    expect(result.error.code).toBe(code);
  }
}

export function expectSuccess(
  result: ToolRouteResultLike,
): asserts result is Extract<ToolRouteResultLike, { status: "success" }> {
  expect(result.status).toBe("success");
}

/** Vérifie qu’aucun secret / stack / payload brut sensible n’est exposé. */
export function expectNoSensitiveLeak(result: unknown): void {
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain(SENSITIVE_RAW_TOKEN);
  expect(serialized).not.toContain("sk_live_");
  expect(serialized).not.toContain(SENSITIVE_RAW_FIELD);
  expect(serialized).not.toMatch(/"stack"\s*:/);
  expect(serialized).not.toContain("at Object.");
  expect(serialized).not.toContain("at async");
}

export function expectNoStackLeak(result: unknown): void {
  const serialized = JSON.stringify(result);
  expect(serialized).not.toMatch(/"stack"\s*:/);
  expect(serialized).not.toContain("\n    at ");
}
