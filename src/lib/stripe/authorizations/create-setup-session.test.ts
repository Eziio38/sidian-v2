import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const mocks = vi.hoisted(() => ({
  rails: ["card", "sepa_core"] as Array<"card" | "sepa_core">,
  rateAllowed: true,
}));

vi.mock("@/lib/stripe/connect/retrieve-and-sync", () => ({
  resolveConnectedAccountPaymentRails: vi.fn(async () => ({
    account: { id: "acct_1" },
    rails: mocks.rails,
  })),
}));

vi.mock("@/lib/stripe/checkout/rate-limit", () => ({
  pseudonymizeRateLimitSubject: (category: string) => `hash_${category}`,
  consumePublicRateLimit: vi.fn(async () => ({
    allowed: mocks.rateAllowed,
    remaining: mocks.rateAllowed ? 4 : 0,
    reset_at: null,
  })),
}));

import {
  createAuthorizationSetupSession,
  declineAuthorizationProposal,
  prepareAuthorizationReconsideration,
  prepareAuthorizationProposalForPayment,
  resolveAuthorizationProposalForDisplay,
} from "./create-setup-session";
import {
  authorizationTokenForReconsideration,
  authorizationTokenForTentative,
  authorizationTokenHash,
} from "./token";

const RAW_TOKEN = "A".repeat(43);
const AUTHORIZATION_ID = "11111111-1111-4111-8111-111111111111";
const PRESTATAIRE_ID = "22222222-2222-4222-8222-222222222222";
const CLIENT_ID = "33333333-3333-4333-8333-333333333333";

function makeAdmin(handlers: Record<string, (args: unknown) => unknown>) {
  const rpc = vi.fn(async (name: string, args: unknown) => {
    const handler = handlers[name];
    return handler ? handler(args) : { data: null, error: null };
  });
  return { admin: { rpc } as never, rpc };
}

function context() {
  return {
    found: true,
    authorization_id: AUTHORIZATION_ID,
    etat: "PROPOSEE",
    expired: false,
    stripe_account_id: "acct_1",
    stripe_customer_id: "cus_1",
    authorization_text_version: "sidian-future-payments-fr-v1",
    source_checkout_session_id: "cs_payment",
    prestataire_id: PRESTATAIRE_ID,
    client_payeur_id: CLIENT_ID,
  };
}

function makeStripe(sourceOverrides: Record<string, unknown> = {}) {
  const retrieve = vi.fn(async (id: string) => ({
    id,
    mode: "payment",
    status: "complete",
    payment_status: "unpaid",
    customer: "cus_1",
    ...sourceOverrides,
  }));
  const create = vi.fn(async () => ({
    id: "cs_setup",
    mode: "setup",
    status: "open",
    url: "https://checkout.stripe/setup",
    setup_intent: "seti_1",
    expires_at: 1_900_000_000,
  }));
  return {
    checkout: { sessions: { retrieve, create } },
    customers: {
      retrieve: vi.fn(async () => ({
        id: "cus_1",
        deleted: false,
        metadata: {
          sidian_prestataire_id: PRESTATAIRE_ID,
          sidian_client_payeur_id: CLIENT_ID,
          sidian_environment: "local",
        },
      })),
    },
  } as never;
}

function reusableSetupSession(overrides: Record<string, unknown> = {}) {
  return {
    object: "checkout.session",
    id: "cs_setup_old",
    mode: "setup",
    status: "open",
    url: "https://checkout.stripe/old",
    customer: "cus_1",
    currency: "eur",
    metadata: {
      sidian_payment_authorization_id: AUTHORIZATION_ID,
      sidian_authorization_text_version: "sidian-future-payments-fr-v1",
    },
    payment_method_types: ["card", "sepa_debit"],
    ...overrides,
  };
}

beforeEach(() => {
  mocks.rails = ["card", "sepa_core"];
  mocks.rateAllowed = true;
});

describe("token d'autorisation", () => {
  it("est opaque, stable pour la tentative et séparé par secret", () => {
    const first = authorizationTokenForTentative("tentative-1", "secret-a");
    const replay = authorizationTokenForTentative("tentative-1", "secret-a");
    const other = authorizationTokenForTentative("tentative-1", "secret-b");

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(replay).toBe(first);
    expect(other).not.toBe(first);
    expect(authorizationTokenHash(first)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("dérive un token de reconsidération stable mais distinct par cycle refusé", () => {
    const first = authorizationTokenForReconsideration(
      RAW_TOKEN,
      AUTHORIZATION_ID,
      "secret-test",
    );
    const replay = authorizationTokenForReconsideration(
      RAW_TOKEN,
      AUTHORIZATION_ID,
      "secret-test",
    );
    const nextCycle = authorizationTokenForReconsideration(
      RAW_TOKEN,
      "44444444-4444-4444-8444-444444444444",
      "secret-test",
    );
    expect(first).toBe(replay);
    expect(nextCycle).not.toBe(first);
  });
});

describe("prepareAuthorizationProposalForPayment", () => {
  it("ne persiste que le hash et restitue le token brut au seul appelant", async () => {
    const { admin, rpc } = makeAdmin({
      prepare_payment_authorization_proposal: () => ({
        data: { status: "proposed" },
        error: null,
      }),
    });
    const result = await prepareAuthorizationProposalForPayment({
      supabaseAdmin: admin,
      tentativeId: "tentative-1",
      stripeAccountId: "acct_1",
      stripeCustomerId: "cus_1",
      tokenSecret: "secret-test",
      now: new Date("2026-07-21T12:00:00.000Z"),
    });

    expect(result?.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_public_token_hash).toBe(
      authorizationTokenHash(result!.rawToken),
    );
    expect(JSON.stringify(args)).not.toContain(result!.rawToken);
  });
});

describe("createAuthorizationSetupSession", () => {
  it("propose card + SEPA actifs dans le même Connect/Customer même si le paiement initial est encore unpaid", async () => {
    const { admin, rpc } = makeAdmin({
      resolve_payment_authorization_setup_context: () => ({
        data: context(),
        error: null,
      }),
      claim_payment_authorization_setup: () => ({
        data: {
          status: "claimed",
          authorization_id: AUTHORIZATION_ID,
          lease_token: "44444444-4444-4444-8444-444444444444",
          idempotency_key: "sidian_setup_stable",
        },
        error: null,
      }),
      complete_payment_authorization_setup: () => ({ data: {}, error: null }),
    });
    const stripe = makeStripe();
    const result = await createAuthorizationSetupSession({
      supabaseAdmin: admin,
      rawToken: RAW_TOKEN,
      sourceCheckoutSessionId: "cs_payment",
      clientIp: "203.0.113.8",
      consentAccepted: true,
      appUrl: "https://app.sidian.test",
      sidianEnvironment: "local",
      stripe,
    });

    expect(result).toEqual({
      status: "ready",
      url: "https://checkout.stripe/setup",
    });
    const create = (stripe as unknown as {
      checkout: { sessions: { create: ReturnType<typeof vi.fn> } };
    }).checkout.sessions.create;
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "setup",
        currency: "eur",
        customer: "cus_1",
        payment_method_types: ["card", "sepa_debit"],
        setup_intent_data: {
          metadata: expect.objectContaining({
            sidian_payment_authorization_id: AUTHORIZATION_ID,
          }),
        },
      }),
      {
        stripeAccount: "acct_1",
        idempotencyKey: "sidian_setup_stable",
      },
    );
    expect(rpc).toHaveBeenCalledWith(
      "complete_payment_authorization_setup",
      expect.objectContaining({
        p_stripe_account_id: "acct_1",
        p_stripe_customer_id: "cus_1",
        p_stripe_setup_checkout_session_id: "cs_setup",
      }),
    );
  });

  it("card active / SEPA inactive ne transmet que card à Stripe", async () => {
    mocks.rails = ["card"];
    const { admin } = makeAdmin({
      resolve_payment_authorization_setup_context: () => ({
        data: context(),
        error: null,
      }),
      claim_payment_authorization_setup: () => ({
        data: {
          status: "claimed",
          authorization_id: AUTHORIZATION_ID,
          lease_token: "44444444-4444-4444-8444-444444444444",
          idempotency_key: "sidian_setup_stable",
        },
        error: null,
      }),
      complete_payment_authorization_setup: () => ({ data: {}, error: null }),
    });
    const stripe = makeStripe();

    await createAuthorizationSetupSession({
      supabaseAdmin: admin,
      rawToken: RAW_TOKEN,
      sourceCheckoutSessionId: "cs_payment",
      clientIp: "203.0.113.8",
      consentAccepted: true,
      appUrl: "https://app.sidian.test",
      sidianEnvironment: "local",
      stripe,
    });

    const create = (stripe as unknown as {
      checkout: { sessions: { create: ReturnType<typeof vi.fn> } };
    }).checkout.sessions.create;
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_method_types: ["card"] }),
      expect.anything(),
    );
  });

  it("refuse avant claim une Session source non terminée", async () => {
    const { admin, rpc } = makeAdmin({
      resolve_payment_authorization_setup_context: () => ({
        data: context(),
        error: null,
      }),
    });
    const result = await createAuthorizationSetupSession({
      supabaseAdmin: admin,
      rawToken: RAW_TOKEN,
      sourceCheckoutSessionId: "cs_payment",
      clientIp: "203.0.113.8",
      consentAccepted: true,
      appUrl: "https://app.sidian.test",
      sidianEnvironment: "local",
      stripe: makeStripe({ status: "open" }),
    });

    expect(result).toEqual({ status: "not_available" });
    expect(rpc).not.toHaveBeenCalledWith(
      "claim_payment_authorization_setup",
      expect.anything(),
    );
  });

  it("expire et invalide une Session setup ouverte dont les rails ne correspondent plus au live", async () => {
    mocks.rails = ["card"];
    const { admin, rpc } = makeAdmin({
      resolve_payment_authorization_setup_context: () => ({
        data: context(),
        error: null,
      }),
      claim_payment_authorization_setup: () => ({
        data: {
          status: "already_created",
          authorization_id: AUTHORIZATION_ID,
          stripe_account_id: "acct_1",
          stripe_customer_id: "cus_1",
          stripe_setup_checkout_session_id: "cs_setup_old",
          idempotency_key: "sidian_setup_old",
        },
        error: null,
      }),
      invalidate_payment_authorization_setup_session: () => ({
        data: {},
        error: null,
      }),
    });
    const retrieve = vi
      .fn()
      .mockResolvedValueOnce({
        id: "cs_payment",
        mode: "payment",
        status: "complete",
        payment_status: "unpaid",
        customer: "cus_1",
      })
      .mockResolvedValueOnce(reusableSetupSession());
    const expire = vi.fn(async () => ({ id: "cs_setup_old", status: "expired" }));
    const create = vi.fn();
    const stripe = {
      checkout: { sessions: { retrieve, expire, create } },
      customers: {
        retrieve: vi.fn(async () => ({
          id: "cus_1",
          deleted: false,
          metadata: {
            sidian_prestataire_id: PRESTATAIRE_ID,
            sidian_client_payeur_id: CLIENT_ID,
            sidian_environment: "local",
          },
        })),
      },
    } as unknown as Stripe;

    const result = await createAuthorizationSetupSession({
      supabaseAdmin: admin,
      rawToken: RAW_TOKEN,
      sourceCheckoutSessionId: "cs_payment",
      clientIp: "203.0.113.8",
      consentAccepted: true,
      appUrl: "https://app.sidian.test",
      sidianEnvironment: "local",
      stripe,
    });

    expect(result).toEqual({ status: "retry" });
    expect(expire).toHaveBeenCalledWith(
      "cs_setup_old",
      {},
      {
        stripeAccount: "acct_1",
        idempotencyKey: "sidian_setup_rails_changed_cs_setup_old",
      },
    );
    expect(rpc).toHaveBeenCalledWith(
      "invalidate_payment_authorization_setup_session",
      {
        p_authorization_id: AUTHORIZATION_ID,
        p_stripe_setup_checkout_session_id: "cs_setup_old",
        p_reason: "setup_capabilities_changed",
      },
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("réutilise une Session setup ouverte seulement si identité et rails live sont exacts", async () => {
    const { admin } = makeAdmin({
      resolve_payment_authorization_setup_context: () => ({
        data: context(),
        error: null,
      }),
      claim_payment_authorization_setup: () => ({
        data: {
          status: "already_created",
          authorization_id: AUTHORIZATION_ID,
          stripe_account_id: "acct_1",
          stripe_customer_id: "cus_1",
          stripe_setup_checkout_session_id: "cs_setup_old",
        },
        error: null,
      }),
    });
    const retrieve = vi
      .fn()
      .mockResolvedValueOnce({
        id: "cs_payment",
        mode: "payment",
        status: "complete",
        payment_status: "unpaid",
        customer: "cus_1",
      })
      .mockResolvedValueOnce(reusableSetupSession());
    const expire = vi.fn();
    const stripe = {
      checkout: { sessions: { retrieve, expire, create: vi.fn() } },
      customers: (makeStripe() as unknown as { customers: unknown }).customers,
    } as unknown as Stripe;

    await expect(
      createAuthorizationSetupSession({
        supabaseAdmin: admin,
        rawToken: RAW_TOKEN,
        sourceCheckoutSessionId: "cs_payment",
        clientIp: "203.0.113.8",
        consentAccepted: true,
        appUrl: "https://app.sidian.test",
        sidianEnvironment: "local",
        stripe,
      }),
    ).resolves.toEqual({
      status: "ready",
      url: "https://checkout.stripe/old",
    });
    expect(expire).not.toHaveBeenCalled();
  });

  it.each([
    ["objet", { object: "payment_intent" }],
    ["identifiant", { id: "cs_setup_other" }],
    ["mode", { mode: "payment" }],
    ["Customer", { customer: "cus_other" }],
    ["devise", { currency: "usd" }],
    [
      "autorisation metadata",
      {
        metadata: {
          sidian_payment_authorization_id: "other",
          sidian_authorization_text_version: "sidian-future-payments-fr-v1",
        },
      },
    ],
    [
      "consentement metadata",
      {
        metadata: {
          sidian_payment_authorization_id: AUTHORIZATION_ID,
          sidian_authorization_text_version: "old-version",
        },
      },
    ],
  ])(
    "Session setup ambiguë (%s) : aucune URL et aucune expiration",
    async (_label, setupOverride) => {
      mocks.rails = ["card"];
      const { admin, rpc } = makeAdmin({
        resolve_payment_authorization_setup_context: () => ({
          data: context(),
          error: null,
        }),
        claim_payment_authorization_setup: () => ({
          data: {
            status: "already_created",
            authorization_id: AUTHORIZATION_ID,
            stripe_account_id: "acct_1",
            stripe_customer_id: "cus_1",
            stripe_setup_checkout_session_id: "cs_setup_old",
          },
          error: null,
        }),
      });
      const retrieve = vi
        .fn()
        .mockResolvedValueOnce({
          id: "cs_payment",
          mode: "payment",
          status: "complete",
          payment_status: "unpaid",
          customer: "cus_1",
        })
        .mockResolvedValueOnce(reusableSetupSession(setupOverride));
      const expire = vi.fn();
      const stripe = {
        checkout: { sessions: { retrieve, expire, create: vi.fn() } },
        customers: (makeStripe() as unknown as { customers: unknown }).customers,
      } as unknown as Stripe;

      await expect(
        createAuthorizationSetupSession({
          supabaseAdmin: admin,
          rawToken: RAW_TOKEN,
          sourceCheckoutSessionId: "cs_payment",
          clientIp: "203.0.113.8",
          consentAccepted: true,
          appUrl: "https://app.sidian.test",
          sidianEnvironment: "local",
          stripe,
        }),
      ).resolves.toEqual({ status: "retry" });
      expect(expire).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalledWith(
        "invalidate_payment_authorization_setup_session",
        expect.anything(),
      );
    },
  );

  it("exige une acceptation explicite avant toute lecture Stripe", async () => {
    const { admin, rpc } = makeAdmin({});
    const stripe = makeStripe();
    const result = await createAuthorizationSetupSession({
      supabaseAdmin: admin,
      rawToken: RAW_TOKEN,
      sourceCheckoutSessionId: "cs_payment",
      clientIp: "203.0.113.8",
      consentAccepted: false,
      appUrl: "https://app.sidian.test",
      sidianEnvironment: "local",
      stripe,
    });

    expect(result).toEqual({ status: "not_available" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("resolveAuthorizationProposalForDisplay", () => {
  it.each([
    ["source surdimensionnée", `cs_${"A".repeat(300)}`, undefined],
    ["source malformée", "not-a-session", undefined],
    ["setup surdimensionnée", "cs_payment", `cs_${"B".repeat(300)}`],
  ])("%s → not_found avant quotas et RPC", async (_label, sourceId, setupId) => {
    const { admin, rpc } = makeAdmin({});
    await expect(
      resolveAuthorizationProposalForDisplay({
        supabaseAdmin: admin,
        rawToken: RAW_TOKEN,
        sourceCheckoutSessionId: sourceId,
        setupCheckoutSessionId: setupId,
        clientIp: "203.0.113.8",
      }),
    ).resolves.toEqual({ status: "not_found" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("reconsidération après refus", () => {
  it("n'est ouverte que par l'action client et revérifie rails/Customer live", async () => {
    mocks.rails = ["card"];
    const { admin, rpc } = makeAdmin({
      resolve_authorization_reconsideration_context: () => ({
        data: {
          found: true,
          authorization_id: AUTHORIZATION_ID,
          stripe_account_id: "acct_1",
          stripe_customer_id: "cus_1",
          authorization_text_version: "sidian-future-payments-fr-v1",
          prestataire_id: PRESTATAIRE_ID,
          client_payeur_id: CLIENT_ID,
          source_checkout_session_id: "cs_initial",
        },
        error: null,
      }),
      prepare_reconsidered_authorization_proposal: () => ({
        data: {
          status: "proposed",
          source_checkout_session_id: "cs_initial",
        },
        error: null,
      }),
    });
    const result = await prepareAuthorizationReconsideration({
      supabaseAdmin: admin,
      rawPaymentLinkToken: RAW_TOKEN,
      clientIp: "203.0.113.8",
      appUrl: "https://app.sidian.test",
      sidianEnvironment: "local",
      stripe: makeStripe(),
      tokenSecret: "test-secret",
      now: new Date("2026-07-21T12:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "ready",
      url: expect.stringContaining(
        "/p/retour?session_id=cs_initial&authorization_token=",
      ),
    });
    expect(rpc).toHaveBeenCalledWith(
      "prepare_reconsidered_authorization_proposal",
      expect.objectContaining({
        p_refused_authorization_id: AUTHORIZATION_ID,
        p_stripe_account_id: "acct_1",
        p_stripe_customer_id: "cus_1",
        p_authorization_text_version: "sidian-future-payments-fr-v1",
        p_public_token_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(
      "authorization_token=",
    );
  });
});

describe("declineAuthorizationProposal", () => {
  it("bloque la mutation dès qu'un quota persistant IP ou token est dépassé", async () => {
    mocks.rateAllowed = false;
    const { admin, rpc } = makeAdmin({
      decline_payment_authorization_proposal: () => ({
        data: { declined: true },
        error: null,
      }),
    });

    await expect(
      declineAuthorizationProposal({
        supabaseAdmin: admin,
        rawToken: RAW_TOKEN,
        sourceCheckoutSessionId: "cs_payment",
        clientIp: "203.0.113.8",
      }),
    ).resolves.toBe("rate_limited");
    expect(rpc).not.toHaveBeenCalled();
  });
});
