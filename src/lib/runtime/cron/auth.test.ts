/**
 * Tests auth cron — Bearer CRON_SECRET, jamais en query.
 */

import { afterEach, describe, expect, it } from "vitest";

import { assertCronAuthorized, getCronSecret } from "./auth";

const VALID_SECRET = "cron-secret-at-least-16";

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("cron auth", () => {
  it("fail-closed si CRON_SECRET absent ou trop court", () => {
    expect(getCronSecret({})).toBeNull();
    expect(getCronSecret({ CRON_SECRET: "short" })).toBeNull();
    expect(getCronSecret({ CRON_SECRET: VALID_SECRET })).toBe(VALID_SECRET);
  });

  it("refuse secret en query string", () => {
    process.env.CRON_SECRET = VALID_SECRET;
    const result = assertCronAuthorized(
      new Request(
        `https://app.example/api/cron/drains?secret=${VALID_SECRET}`,
      ),
    );
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: "unauthorized",
    });
  });

  it("refuse sans Bearer", () => {
    process.env.CRON_SECRET = VALID_SECRET;
    const result = assertCronAuthorized(
      new Request("https://app.example/api/cron/scanners"),
    );
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: "unauthorized",
    });
  });

  it("accepte Authorization Bearer valide", () => {
    process.env.CRON_SECRET = VALID_SECRET;
    const result = assertCronAuthorized(
      new Request("https://app.example/api/cron/scanners", {
        headers: { Authorization: `Bearer ${VALID_SECRET}` },
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("503 si secret non configuré", () => {
    const result = assertCronAuthorized(
      new Request("https://app.example/api/cron/scanners", {
        headers: { Authorization: `Bearer ${VALID_SECRET}` },
      }),
    );
    expect(result).toEqual({
      ok: false,
      status: 503,
      error: "cron_not_configured",
    });
  });
});
