/**
 * Assertions HTTP G1-L — réponses sanitizées.
 */

import { expect } from "vitest";

import type { AgentServerResponseBody } from "@/lib/agent/server";

import {
  RAW_AUTH_PROVIDER_DETAIL,
  SENSITIVE_APP_SECRET,
  SENSITIVE_COOKIE_VALUE,
  SENSITIVE_RAW_JWT,
  SENSITIVE_RAW_TOKEN,
  SENSITIVE_SQL_FRAGMENT,
  SENSITIVE_STACK_FRAGMENT,
} from "./constants";

export async function readJsonBody(
  response: Response,
): Promise<AgentServerResponseBody> {
  const body = (await response.json()) as AgentServerResponseBody;
  return body;
}

export function expectHttpBodyShape(body: AgentServerResponseBody): void {
  expect(body).toEqual(
    expect.objectContaining({
      request_id: expect.any(String),
      correlation_id: expect.any(String),
      status: expect.stringMatching(/^(success|blocked|pending|error)$/),
      code: expect.any(String),
      data: expect.any(Object),
      degraded: expect.objectContaining({
        observability: expect.any(Boolean),
      }),
    }),
  );
  expect(body.request_id.length).toBeGreaterThan(0);
  expect(body.correlation_id.length).toBeGreaterThan(0);
}

export function expectNoSensitiveHttpLeak(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(SENSITIVE_RAW_TOKEN);
  expect(serialized).not.toContain("sk_live_");
  expect(serialized).not.toContain(SENSITIVE_RAW_JWT);
  expect(serialized).not.toContain("g1k_SENSITIVE_JWT_PAYLOAD");
  expect(serialized).not.toContain("g1l_SENSITIVE_COOKIE");
  expect(serialized).not.toContain(SENSITIVE_COOKIE_VALUE);
  expect(serialized).not.toContain(SENSITIVE_APP_SECRET);
  expect(serialized).not.toContain(SENSITIVE_SQL_FRAGMENT);
  expect(serialized).not.toContain("SELECT * FROM");
  expect(serialized).not.toMatch(/"stack"\s*:/);
  expect(serialized).not.toContain(SENSITIVE_STACK_FRAGMENT);
  expect(serialized).not.toContain("at Object.");
  expect(serialized).not.toContain("\n    at ");
  expect(serialized).not.toContain(RAW_AUTH_PROVIDER_DETAIL);
  expect(serialized).not.toContain("AuthApiError");
  expect(serialized).not.toMatch(/"jwt"\s*:/);
  expect(serialized).not.toMatch(/"access_token"\s*:/);
  expect(serialized).not.toMatch(/"refresh_token"\s*:/);
  expect(serialized).not.toMatch(/"bearer_token"\s*:/);
  expect(serialized).not.toMatch(/"cookie"\s*:/);
  expect(serialized).not.toContain("eyJhbGciOi");
}

export async function expectErrorResponse(
  response: Response,
  expected: {
    httpStatus: number;
    code: string;
    status?: "error" | "blocked" | "pending";
  },
): Promise<AgentServerResponseBody> {
  expect(response.status).toBe(expected.httpStatus);
  const body = await readJsonBody(response);
  expectHttpBodyShape(body);
  expect(body.code).toBe(expected.code);
  expect(body.status).toBe(expected.status ?? "error");
  expectNoSensitiveHttpLeak(body);
  return body;
}

export async function expectSuccessResponse(
  response: Response,
): Promise<AgentServerResponseBody> {
  expect(response.status).toBe(200);
  const body = await readJsonBody(response);
  expectHttpBodyShape(body);
  expect(body.status).toBe("success");
  expect(body.code).toBe("OK");
  expectNoSensitiveHttpLeak(body);
  return body;
}
