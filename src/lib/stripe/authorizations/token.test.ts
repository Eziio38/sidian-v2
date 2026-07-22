import { afterEach, describe, expect, it } from "vitest";

import {
  authorizationTokenForReconsideration,
  authorizationTokenForTentative,
  authorizationTokenHash,
} from "./token";

const ENV_KEY = "SIDIAN_PAYMENT_AUTHORIZATION_TOKEN_SECRET";

describe("authorization tokens", () => {
  const previous = process.env[ENV_KEY];

  afterEach(() => {
    if (previous === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = previous;
  });

  it("produit un token stable pour une tentative et un secret donnés", () => {
    const first = authorizationTokenForTentative("tentative-1", "secret-a-32-chars-minimum-xx");
    const replay = authorizationTokenForTentative(
      "tentative-1",
      "secret-a-32-chars-minimum-xx",
    );
    const other = authorizationTokenForTentative(
      "tentative-1",
      "secret-b-32-chars-minimum-yy",
    );
    expect(first).toBe(replay);
    expect(first).not.toBe(other);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorizationTokenHash(first)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("échoue fermé si le secret d'environnement est absent", () => {
    delete process.env[ENV_KEY];
    expect(() => authorizationTokenForTentative("tentative-1")).toThrow();
  });

  it("ne conserve pas la valeur après rotation du secret", () => {
    const before = authorizationTokenForTentative(
      "tentative-1",
      "secret-before-rotation-32chars!",
    );
    const after = authorizationTokenForTentative(
      "tentative-1",
      "secret-after-rotation-32chars!!",
    );
    expect(before).not.toBe(after);
    expect(
      authorizationTokenForReconsideration(
        "A".repeat(43),
        "11111111-1111-4111-8111-111111111111",
        "secret-before-rotation-32chars!",
      ),
    ).not.toBe(
      authorizationTokenForReconsideration(
        "A".repeat(43),
        "11111111-1111-4111-8111-111111111111",
        "secret-after-rotation-32chars!!",
      ),
    );
  });
});
