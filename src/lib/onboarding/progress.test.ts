import { describe, expect, it } from "vitest";

import { buildOnboardingSteps, getOnboardingCompletion } from "./progress";

describe("progression onboarding", () => {
  it("ne demande Stripe qu’après le premier paiement à recevoir", () => {
    const steps = buildOnboardingSteps({
      profileConfigured: true,
      hasClient: true,
      hasPaymentReceivable: false,
      stripeReady: false,
    });

    expect(steps.find((step) => step.id === "payment")?.available).toBe(true);
    expect(steps.find((step) => step.id === "stripe")?.available).toBe(false);
  });

  it("calcule la progression sans confondre compte créé et Stripe payable", () => {
    const steps = buildOnboardingSteps({
      profileConfigured: true,
      hasClient: true,
      hasPaymentReceivable: true,
      stripeReady: false,
    });

    expect(getOnboardingCompletion(steps)).toEqual({
      completed: 3,
      total: 4,
      percentage: 75,
    });
    expect(steps.at(-1)?.completed).toBe(false);
  });
});
