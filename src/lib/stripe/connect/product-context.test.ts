import { describe, expect, it, vi } from "vitest";

import { getStripeConnectProductContext } from "@/lib/stripe/connect/product-context";

function clientFixture(input: {
  stripeAccountId: string | null;
  receivableId: string | null;
}) {
  const prestataireEq = vi.fn(() => ({
    single: vi.fn(async () => ({
      data: { stripe_account_id: input.stripeAccountId },
      error: null,
    })),
  }));
  const receivableMaybeSingle = vi.fn(async () => ({
    data: input.receivableId ? { id: input.receivableId } : null,
    error: null,
  }));

  return {
    prestataireEq,
    client: {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: "user_1" } },
          error: null,
        })),
      },
      from: vi.fn((table: string) => {
        if (table === "prestataire") {
          return {
            select: vi.fn(() => ({ eq: prestataireEq })),
          };
        }

        return {
          select: vi.fn(() => ({
            is: vi.fn(() => ({
              limit: vi.fn(() => ({
                maybeSingle: receivableMaybeSingle,
              })),
            })),
          })),
        };
      }),
    },
  };
}

describe("contexte produit Stripe Connect", () => {
  it("dérive le contexte de la session et de la RLS, sans identifiant navigateur", async () => {
    const fixture = clientFixture({
      stripeAccountId: null,
      receivableId: "receivable_1",
    });

    const context = await getStripeConnectProductContext(
      fixture.client as never,
    );

    expect(fixture.prestataireEq).toHaveBeenCalledWith("user_id", "user_1");
    expect(context).toEqual({
      hasConnectedAccount: false,
      hasReceivable: true,
    });
  });

  it("distingue un compte existant d'une première activation prématurée", async () => {
    const existing = clientFixture({
      stripeAccountId: "acct_1",
      receivableId: null,
    });
    const premature = clientFixture({
      stripeAccountId: null,
      receivableId: null,
    });

    await expect(
      getStripeConnectProductContext(existing.client as never),
    ).resolves.toEqual({
      hasConnectedAccount: true,
      hasReceivable: false,
    });
    await expect(
      getStripeConnectProductContext(premature.client as never),
    ).resolves.toEqual({
      hasConnectedAccount: false,
      hasReceivable: false,
    });
  });
});
