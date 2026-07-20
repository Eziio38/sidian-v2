import { describe, expect, it } from "vitest";

import { validateStripeEnvironment } from "@/config/env-server";

function fakeWriterJwt(environment: "local" | "staging" | "production") {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${encode({ alg: "ES256", typ: "JWT" })}.${encode({
    role: "stripe_customer_binding_writer",
    sidian_environment: environment,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.test-signature`;
}

const testConfig = {
  NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED: "true",
  SIDIAN_ENVIRONMENT: "local",
  STRIPE_MODE: "test",
  STRIPE_SECRET_KEY: "sk_test_example",
  STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_example",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_example",
  SUPABASE_STRIPE_BINDING_WRITER_JWT: fakeWriterJwt("local"),
} as const;

const liveConfig = {
  NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED: "true",
  SIDIAN_ENVIRONMENT: "production",
  STRIPE_MODE: "live",
  STRIPE_SECRET_KEY: "sk_live_example",
  STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_example",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_example",
  SUPABASE_STRIPE_BINDING_WRITER_JWT: fakeWriterJwt("production"),
} as const;

describe("configuration Stripe fail-closed", () => {
  it("accepte test hors production et live en production", () => {
    expect(validateStripeEnvironment(testConfig, "local")).toMatchObject({
      enabled: true,
      STRIPE_MODE: "test",
    });
    expect(validateStripeEnvironment(liveConfig, "production")).toMatchObject({
      enabled: true,
      STRIPE_MODE: "live",
    });
    expect(
      validateStripeEnvironment(
        { NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED: "false" },
        "local",
      ),
    ).toEqual({ enabled: false });
  });

  it.each([
    [liveConfig, "local"],
    [testConfig, "production"],
    [{ ...testConfig, STRIPE_MODE: "live" }, "local"],
    [{ ...liveConfig, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_example" }, "production"],
    [{ ...testConfig, STRIPE_CONNECT_WEBHOOK_SECRET: "not-a-secret" }, "local"],
    [{ ...testConfig, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: undefined }, "local"],
    [{ ...testConfig, SIDIAN_ENVIRONMENT: "staging" }, "local"],
    [{ ...testConfig, SUPABASE_STRIPE_BINDING_WRITER_JWT: fakeWriterJwt("staging") }, "local"],
    [{ ...testConfig, SUPABASE_STRIPE_BINDING_WRITER_JWT: "invalid" }, "local"],
    [{ NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED: undefined }, "local"],
  ] as const)("refuse une combinaison incohérente", (config, environment) => {
    expect(() => validateStripeEnvironment(config, environment)).toThrow(
      /Configuration Stripe/,
    );
  });
});
