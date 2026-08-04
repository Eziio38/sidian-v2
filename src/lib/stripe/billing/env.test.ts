import { describe, expect, it } from "vitest";

import { resolveSidianBillingReadiness } from "@/lib/stripe/billing/env";

const VALID = {
  STRIPE_BILLING_SECRET_KEY: "sk_test_abc123",
  STRIPE_BILLING_PRICE_ID: "price_abc123",
  STRIPE_BILLING_WEBHOOK_SECRET: "whsec_billing_abc",
};

describe("resolveSidianBillingReadiness", () => {
  it("se déclare simplement absente sans aucune variable", () => {
    expect(resolveSidianBillingReadiness({}, "local", undefined)).toEqual({
      enabled: false,
      reason: "not_configured",
    });
  });

  it("refuse une configuration partielle plutôt que de deviner", () => {
    const result = resolveSidianBillingReadiness(
      { STRIPE_BILLING_SECRET_KEY: VALID.STRIPE_BILLING_SECRET_KEY },
      "local",
      undefined,
    );
    expect(result).toEqual({ enabled: false, reason: "invalid_configuration" });
  });

  it("active le module avec les trois variables", () => {
    const result = resolveSidianBillingReadiness(VALID, "local", undefined);
    expect(result).toMatchObject({
      enabled: true,
      priceId: "price_abc123",
      mode: "test",
      environment: "local",
      earlyAccessLockMonths: null,
    });
  });

  it("refuse de partager le secret webhook avec Connect", () => {
    const result = resolveSidianBillingReadiness(
      VALID,
      "local",
      VALID.STRIPE_BILLING_WEBHOOK_SECRET,
    );
    expect(result).toEqual({ enabled: false, reason: "shared_with_connect" });
  });

  it("refuse une clé test en production", () => {
    const result = resolveSidianBillingReadiness(VALID, "production", undefined);
    expect(result).toEqual({ enabled: false, reason: "environment_mismatch" });
  });

  it("refuse une clé live hors production", () => {
    const result = resolveSidianBillingReadiness(
      { ...VALID, STRIPE_BILLING_SECRET_KEY: "sk_live_abc123" },
      "staging",
      undefined,
    );
    expect(result).toEqual({ enabled: false, reason: "environment_mismatch" });
  });

  it("refuse un identifiant de prix qui n'en est pas un", () => {
    const result = resolveSidianBillingReadiness(
      { ...VALID, STRIPE_BILLING_PRICE_ID: "prod_abc123" },
      "local",
      undefined,
    );
    expect(result).toEqual({ enabled: false, reason: "invalid_configuration" });
  });

  it("lit la durée de verrouillage Early Access lorsqu'elle est décidée", () => {
    const result = resolveSidianBillingReadiness(
      { ...VALID, STRIPE_BILLING_EARLY_ACCESS_LOCK_MONTHS: "12" },
      "local",
      undefined,
    );
    expect(result).toMatchObject({ enabled: true, earlyAccessLockMonths: 12 });
  });

  it("refuse une durée de verrouillage aberrante", () => {
    const result = resolveSidianBillingReadiness(
      { ...VALID, STRIPE_BILLING_EARLY_ACCESS_LOCK_MONTHS: "0" },
      "local",
      undefined,
    );
    expect(result).toEqual({ enabled: false, reason: "invalid_configuration" });
  });
});
