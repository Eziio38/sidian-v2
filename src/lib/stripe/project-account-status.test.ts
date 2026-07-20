import { describe, expect, it } from "vitest";
import type Stripe from "stripe";

import {
  buildAllowlistedAccountLinkUrls,
  STRIPE_ACCOUNT_LINK_PATHS,
} from "@/lib/stripe/connect/create-account-link";
import { projectAccountStatus } from "@/lib/stripe/connect/project-account-status";
import { assertConnectedScope } from "@/lib/stripe/shared/assert-connected-scope";
import {
  assertCreanceDeviseEur,
  assertMvpCurrency,
  MVP_CURRENCY,
} from "@/lib/stripe/shared/currency";
import { StripeDomainError } from "@/lib/stripe/shared/errors";
import { isKnownStripeWebhookEvent } from "@/lib/stripe/webhooks/event-types";

function accountFixture(input: {
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
  requirements?: Partial<Stripe.Account.Requirements> | null;
}): Parameters<typeof projectAccountStatus>[0] {
  return {
    id: "acct_1",
    charges_enabled: input.charges_enabled ?? false,
    payouts_enabled: input.payouts_enabled ?? false,
    details_submitted: input.details_submitted ?? false,
    requirements:
      input.requirements === null
        ? undefined
        : ({
            currently_due: [],
            pending_verification: [],
            past_due: [],
            disabled_reason: null,
            alternatives: [],
            current_deadline: null,
            errors: [],
            eventually_due: [],
            ...(input.requirements ?? {}),
          } as Stripe.Account.Requirements),
  };
}

describe("projectAccountStatus", () => {
  it("mappe paiements_actives lorsque charges_enabled", () => {
    const projection = projectAccountStatus(
      accountFixture({
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
      }),
    );
    expect(projection.onboardingStatus).toBe("paiements_actives");
  });

  it("mappe informations_requises", () => {
    const projection = projectAccountStatus(
      accountFixture({
        requirements: {
          currently_due: ["individual.verification.document"],
        },
      }),
    );
    expect(projection.onboardingStatus).toBe("informations_requises");
    expect(projection.currentlyDue).toEqual([
      "individual.verification.document",
    ]);
  });

  it("mappe verification_en_cours", () => {
    const projection = projectAccountStatus(
      accountFixture({
        details_submitted: true,
        requirements: {
          pending_verification: ["individual.verification.document"],
        },
      }),
    );
    expect(projection.onboardingStatus).toBe("verification_en_cours");
  });

  it("mappe action_requise et paiements_indisponibles", () => {
    expect(
      projectAccountStatus(
        accountFixture({
          details_submitted: true,
          requirements: { past_due: ["business_profile.url"] },
        }),
      ).onboardingStatus,
    ).toBe("action_requise");

    expect(
      projectAccountStatus(
        accountFixture({
          details_submitted: true,
          requirements: { disabled_reason: "listed" },
        }),
      ).onboardingStatus,
    ).toBe("paiements_indisponibles");
  });

  it("mappe non_commence par défaut", () => {
    expect(
      projectAccountStatus(accountFixture({ requirements: null }))
        .onboardingStatus,
    ).toBe("non_commence");
  });
});

describe("devise MVP", () => {
  it("accepte uniquement eur", () => {
    expect(MVP_CURRENCY).toBe("eur");
    expect(() => assertMvpCurrency("eur")).not.toThrow();
    expect(() => assertMvpCurrency("EUR")).not.toThrow();
    expect(() => assertMvpCurrency("usd")).toThrow("stripe_currency_not_eur");
    expect(() => assertCreanceDeviseEur("EUR")).not.toThrow();
    expect(() => assertCreanceDeviseEur("USD")).toThrow("creance_devise_not_eur");
  });
});

describe("scope Connect + Account Link allowlist", () => {
  it("refuse un mismatch de compte", () => {
    expect(() =>
      assertConnectedScope({
        expectedAccountId: "acct_a",
        actualAccountId: "acct_b",
        context: "test",
      }),
    ).toThrow(StripeDomainError);
  });

  it("construit des URLs allowlistées", () => {
    const urls = buildAllowlistedAccountLinkUrls("http://127.0.0.1:3000");
    expect(urls.refreshUrl).toBe(
      `http://127.0.0.1:3000${STRIPE_ACCOUNT_LINK_PATHS.refresh}`,
    );
    expect(urls.returnUrl).toBe(
      `http://127.0.0.1:3000${STRIPE_ACCOUNT_LINK_PATHS.return}`,
    );
  });
});

describe("webhook event types", () => {
  it("reconnaît la liste MVP et ignore l'inconnu", () => {
    expect(isKnownStripeWebhookEvent("account.updated")).toBe(true);
    expect(isKnownStripeWebhookEvent("invoice.paid")).toBe(false);
  });
});
