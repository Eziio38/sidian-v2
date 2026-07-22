import { afterEach, describe, expect, it } from "vitest";

import { getPaymentAuthorizationTokenSecret } from "@/config/env-server";

const ENV_KEY = "SIDIAN_PAYMENT_AUTHORIZATION_TOKEN_SECRET";

describe("getPaymentAuthorizationTokenSecret", () => {
  const previous = process.env[ENV_KEY];

  afterEach(() => {
    if (previous === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = previous;
  });

  it("refuse un secret absent", () => {
    delete process.env[ENV_KEY];
    expect(() => getPaymentAuthorizationTokenSecret()).toThrow(
      /autorisation de paiement|payment-authorization-token|manquante/i,
    );
  });

  it("refuse un secret trop court", () => {
    process.env[ENV_KEY] = "too-short";
    expect(() => getPaymentAuthorizationTokenSecret()).toThrow();
  });

  it("refuse un JWT service_role recyclé", () => {
    process.env[ENV_KEY] =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature_padding_ok";
    expect(() => getPaymentAuthorizationTokenSecret()).toThrow();
  });

  it("accepte un secret dédié suffisamment long", () => {
    process.env[ENV_KEY] = "sidian-local-authorization-token-secret-32b";
    expect(getPaymentAuthorizationTokenSecret()).toBe(
      "sidian-local-authorization-token-secret-32b",
    );
  });
});
