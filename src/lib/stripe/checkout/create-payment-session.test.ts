import { beforeEach, describe, expect, it, vi } from "vitest";

import { StripeDomainError } from "@/lib/stripe/shared/errors";

const mocks = vi.hoisted(() => ({
  rateDecision: { allowed: true, remaining: 5, reset_at: null as string | null },
  eligibleThrows: null as unknown,
  eligibleRails: ["card", "sepa_core"] as Array<"card" | "sepa_core">,
  ensureResult: { customerId: "cus_x", created: true },
  proposalThrows: false,
  neutralize: vi.fn(async () => true),
}));

vi.mock("@/lib/stripe/checkout/rate-limit", () => ({
  pseudonymizeRateLimitSubject: (category: string) => `hash_${category}`,
  consumePublicRateLimit: vi.fn(async () => mocks.rateDecision),
}));

vi.mock("@/lib/stripe/customers/ensure-customer", () => ({
  ensureStripeCustomerForClient: vi.fn(async () => mocks.ensureResult),
}));

vi.mock("@/lib/stripe/authorizations/create-setup-session", () => ({
  prepareAuthorizationProposalForPayment: vi.fn(async () => {
    if (mocks.proposalThrows) throw new Error("proposal unavailable");
    return { rawToken: "Z".repeat(43) };
  }),
  neutralizeUnexposedAuthorizationProposal: mocks.neutralize,
}));

vi.mock("@/lib/stripe/connect/retrieve-and-sync", () => ({
  resolveConnectedAccountPaymentRails: vi.fn(async () => {
    if (mocks.eligibleThrows) throw mocks.eligibleThrows;
    return { account: {}, rails: mocks.eligibleRails };
  }),
}));

const { createPaymentCheckoutSession, resolvePaymentLinkForDisplay } = await import(
  "@/lib/stripe/checkout/create-payment-session"
);

const RAW_TOKEN = "A".repeat(43);

function resolvedPayable(overrides: Record<string, unknown> = {}) {
  return {
    found: true,
    payment_link_id: "11111111-1111-4111-8111-111111111111",
    creance_id: "22222222-2222-4222-8222-222222222222",
    prestataire_id: "33333333-3333-4333-8333-333333333333",
    client_payeur_id: "44444444-4444-4444-8444-444444444444",
    stripe_account_id: "acct_1",
    montant: 12000,
    devise: "EUR",
    amount_paid: 0,
    remaining: 12000,
    creance_etat: "OUVERTE",
    creance_archived: false,
    client_email: "client@example.com",
    client_nom: "Client",
    ...overrides,
  };
}

function makeAdmin(handlers: Record<string, (args: unknown) => unknown>) {
  const rpc = vi.fn(async (name: string, args: unknown) => {
    const handler = handlers[name];
    return handler ? handler(args) : { data: null, error: null };
  });
  return { admin: { rpc } as never, rpc };
}

function makeStripe(overrides: Record<string, unknown> = {}) {
  return {
    checkout: {
      sessions: {
        create: vi.fn(async () => ({
          id: "cs_1",
          url: "https://checkout.stripe/cs_1",
          payment_intent: "pi_1",
          expires_at: 1_700_000_000,
        })),
        retrieve: vi.fn(async () => ({
          status: "open",
          url: "https://checkout.stripe/existing",
        })),
        expire: vi.fn(async () => ({ id: "cs_existing", status: "expired" })),
      },
    },
    ...overrides,
  } as never;
}

function reusablePaymentSession(overrides: Record<string, unknown> = {}) {
  return {
    object: "checkout.session",
    id: "cs_existing",
    mode: "payment",
    status: "open",
    payment_status: "unpaid",
    url: "https://checkout.stripe/existing",
    client_reference_id: "t1",
    metadata: {
      sidian_creance_id: resolvedPayable().creance_id,
      sidian_tentative_id: "t1",
    },
    currency: "eur",
    amount_total: 12000,
    customer: "cus_x",
    payment_method_types: ["card", "sepa_debit"],
    ...overrides,
  };
}

function alreadyCreatedClaim(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      status: "already_created",
      tentative_id: "t1",
      montant: 12000,
      stripe_customer_id: "cus_x",
      stripe_checkout_session_id: "cs_existing",
      ...overrides,
    },
    error: null,
  };
}

const base = {
  rawToken: RAW_TOKEN,
  clientIp: "203.0.113.1",
  appUrl: "https://app.sidian.test",
  sidianEnvironment: "local" as const,
};

beforeEach(() => {
  mocks.rateDecision = { allowed: true, remaining: 5, reset_at: null };
  mocks.eligibleThrows = null;
  mocks.eligibleRails = ["card", "sepa_core"];
  mocks.ensureResult = { customerId: "cus_x", created: true };
  mocks.proposalThrows = false;
  mocks.neutralize.mockClear();
});

describe("createPaymentCheckoutSession", () => {
  it("crée une Session et renvoie l'URL (chemin nominal)", async () => {
    const { admin, rpc } = makeAdmin({
      resolve_payment_link_by_token_hash: () => ({ data: resolvedPayable(), error: null }),
      claim_checkout_provisioning: () => ({
        data: {
          status: "claimed",
          tentative_id: "t1",
          montant: 12000,
          idempotency_key: "sidian_checkout_x",
          lease_token: "lease-1",
        },
        error: null,
      }),
      complete_checkout_provisioning: () => ({ data: {}, error: null }),
    });
    const stripe = makeStripe();
    const result = await createPaymentCheckoutSession({ ...base, supabaseAdmin: admin, stripe });
    expect(result).toEqual({
      status: "ready",
      url: "https://checkout.stripe/cs_1",
      tentativeId: "t1",
    });
    const create = (stripe as { checkout: { sessions: { create: ReturnType<typeof vi.fn> } } })
      .checkout.sessions.create;
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "payment",
        customer: "cus_x",
        payment_method_types: ["card", "sepa_debit"],
        metadata: { sidian_creance_id: resolvedPayable().creance_id, sidian_tentative_id: "t1" },
        success_url:
          "https://app.sidian.test/p/retour?session_id={CHECKOUT_SESSION_ID}&authorization_token=" +
          "Z".repeat(43),
      }),
      expect.objectContaining({ stripeAccount: "acct_1", idempotencyKey: "sidian_checkout_x" }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "complete_checkout_provisioning",
      expect.objectContaining({ p_tentative_id: "t1", p_stripe_payment_intent_id: "pi_1" }),
    );
  });

  it("card active / SEPA inactive → propose uniquement card", async () => {
    mocks.eligibleRails = ["card"];
    const { admin } = makeAdmin({
      resolve_payment_link_by_token_hash: () => ({ data: resolvedPayable(), error: null }),
      claim_checkout_provisioning: () => ({
        data: {
          status: "claimed",
          tentative_id: "t1",
          montant: 12000,
          idempotency_key: "sidian_checkout_x",
          lease_token: "lease-1",
        },
        error: null,
      }),
      complete_checkout_provisioning: () => ({ data: {}, error: null }),
    });
    const stripe = makeStripe();

    await expect(
      createPaymentCheckoutSession({ ...base, supabaseAdmin: admin, stripe }),
    ).resolves.toMatchObject({ status: "ready" });

    const create = (stripe as { checkout: { sessions: { create: ReturnType<typeof vi.fn> } } })
      .checkout.sessions.create;
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_method_types: ["card"] }),
      expect.anything(),
    );
  });

  it("préparation d'autorisation indisponible → paiement ready sans proposition", async () => {
    mocks.proposalThrows = true;
    const { admin } = makeAdmin({
      resolve_payment_link_by_token_hash: () => ({ data: resolvedPayable(), error: null }),
      claim_checkout_provisioning: () => ({
        data: {
          status: "claimed",
          tentative_id: "t1",
          montant: 12000,
          idempotency_key: "sidian_checkout_x",
          lease_token: "lease-1",
        },
        error: null,
      }),
      complete_checkout_provisioning: () => ({ data: {}, error: null }),
    });
    const stripe = makeStripe();

    await expect(
      createPaymentCheckoutSession({ ...base, supabaseAdmin: admin, stripe }),
    ).resolves.toMatchObject({ status: "ready" });

    const create = (stripe as { checkout: { sessions: { create: ReturnType<typeof vi.fn> } } })
      .checkout.sessions.create;
    expect(create.mock.calls[0][0].success_url).toBe(
      "https://app.sidian.test/p/retour?session_id={CHECKOUT_SESSION_ID}",
    );
    expect(mocks.neutralize).toHaveBeenCalledWith(
      expect.objectContaining({
        tentativeId: "t1",
        checkoutLeaseToken: "lease-1",
        reason: "authorization_proposal_unavailable",
      }),
    );
  });

  it("renvoie rate_limited si le quota de création est dépassé", async () => {
    mocks.rateDecision = { allowed: false, remaining: 0, reset_at: "2026-07-21T00:00:00Z" };
    const { admin } = makeAdmin({
      resolve_payment_link_by_token_hash: () => ({ data: resolvedPayable(), error: null }),
    });
    const result = await createPaymentCheckoutSession({
      ...base,
      supabaseAdmin: admin,
      stripe: makeStripe(),
    });
    expect(result).toEqual({
      status: "rate_limited",
      category: "checkout_creation_ip",
      resetAt: "2026-07-21T00:00:00Z",
    });
  });

  it("token de forme invalide → not_found sans résolution", async () => {
    const { admin, rpc } = makeAdmin({});
    const result = await createPaymentCheckoutSession({
      ...base,
      rawToken: "trop-court",
      supabaseAdmin: admin,
      stripe: makeStripe(),
    });
    expect(result).toEqual({ status: "not_found" });
    expect(rpc).not.toHaveBeenCalledWith("resolve_payment_link_by_token_hash", expect.anything());
  });

  it("lien introuvable → not_found", async () => {
    const { admin } = makeAdmin({
      resolve_payment_link_by_token_hash: () => ({ data: { found: false }, error: null }),
    });
    const result = await createPaymentCheckoutSession({
      ...base,
      supabaseAdmin: admin,
      stripe: makeStripe(),
    });
    expect(result).toEqual({ status: "not_found" });
  });

  it("créance non ouverte → not_payable", async () => {
    const { admin } = makeAdmin({
      resolve_payment_link_by_token_hash: () => ({
        data: resolvedPayable({ creance_etat: "REGLEE" }),
        error: null,
      }),
    });
    const result = await createPaymentCheckoutSession({
      ...base,
      supabaseAdmin: admin,
      stripe: makeStripe(),
    });
    expect(result).toEqual({ status: "not_payable", reason: "not_open" });
  });

  it("compte connecté non configuré → not_payable", async () => {
    const { admin } = makeAdmin({
      resolve_payment_link_by_token_hash: () => ({
        data: resolvedPayable({ stripe_account_id: null }),
        error: null,
      }),
    });
    const result = await createPaymentCheckoutSession({
      ...base,
      supabaseAdmin: admin,
      stripe: makeStripe(),
    });
    expect(result).toEqual({ status: "not_payable", reason: "account_not_configured" });
  });

  it("compte non payable (revérif live) → not_payable", async () => {
    mocks.eligibleRails = [];
    const { admin } = makeAdmin({
      resolve_payment_link_by_token_hash: () => ({ data: resolvedPayable(), error: null }),
    });
    const result = await createPaymentCheckoutSession({
      ...base,
      supabaseAdmin: admin,
      stripe: makeStripe(),
    });
    expect(result).toEqual({ status: "not_payable", reason: "account_not_payable" });
  });

  it("devise non EUR → not_payable avant revérification ou provisioning", async () => {
    const { admin, rpc } = makeAdmin({
      resolve_payment_link_by_token_hash: () => ({
        data: resolvedPayable({ devise: "USD" }),
        error: null,
      }),
    });
    const stripe = makeStripe();
    const result = await createPaymentCheckoutSession({
      ...base,
      supabaseAdmin: admin,
      stripe,
    });

    expect(result).toEqual({ status: "not_payable", reason: "unsupported_currency" });
    expect(rpc).not.toHaveBeenCalledWith("claim_checkout_provisioning", expect.anything());
    expect(
      (stripe as { checkout: { sessions: { create: ReturnType<typeof vi.fn> } } }).checkout
        .sessions.create,
    ).not.toHaveBeenCalled();
  });

  it("provisioning déjà détenu → retry", async () => {
    const { admin } = makeAdmin({
      resolve_payment_link_by_token_hash: () => ({ data: resolvedPayable(), error: null }),
      claim_checkout_provisioning: () => ({ data: { status: "in_progress" }, error: null }),
    });
    const result = await createPaymentCheckoutSession({
      ...base,
      supabaseAdmin: admin,
      stripe: makeStripe(),
    });
    expect(result).toEqual({ status: "retry" });
  });

  it("réutilise une Session PAYMENT dont l'identité et l'ensemble de rails sont identiques", async () => {
    const { admin } = makeAdmin({
      resolve_payment_link_by_token_hash: () => ({ data: resolvedPayable(), error: null }),
      claim_checkout_provisioning: () => alreadyCreatedClaim(),
    });
    const retrieve = vi.fn(async () => reusablePaymentSession());
    const expire = vi.fn();
    const stripe = makeStripe({
      checkout: { sessions: { create: vi.fn(), retrieve, expire } },
    });

    const result = await createPaymentCheckoutSession({
      ...base,
      supabaseAdmin: admin,
      stripe,
    });

    expect(result).toEqual({
      status: "ready",
      url: "https://checkout.stripe/existing",
      tentativeId: "t1",
    });
    expect(retrieve).toHaveBeenCalledWith(
      "cs_existing",
      {},
      { stripeAccount: "acct_1" },
    );
    expect(expire).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "retrait de SEPA",
      liveRails: ["card"] as Array<"card" | "sepa_core">,
      sessionRails: ["card", "sepa_debit"],
    },
    {
      label: "ajout de SEPA",
      liveRails: ["card", "sepa_core"] as Array<"card" | "sepa_core">,
      sessionRails: ["card"],
    },
  ])(
    "$label : expire la Session ouverte obsolète sans jamais la réexposer",
    async ({ liveRails, sessionRails }) => {
      mocks.eligibleRails = liveRails;
      const { admin } = makeAdmin({
        resolve_payment_link_by_token_hash: () => ({ data: resolvedPayable(), error: null }),
        claim_checkout_provisioning: () => alreadyCreatedClaim(),
      });
      const expire = vi.fn(async () => ({ id: "cs_existing", status: "expired" }));
      const stripe = makeStripe({
        checkout: {
          sessions: {
            create: vi.fn(),
            retrieve: vi.fn(async () =>
              reusablePaymentSession({ payment_method_types: sessionRails }),
            ),
            expire,
          },
        },
      });

      const result = await createPaymentCheckoutSession({
        ...base,
        supabaseAdmin: admin,
        stripe,
      });

      expect(result).toEqual({ status: "retry" });
      expect(expire).toHaveBeenCalledWith(
        "cs_existing",
        {},
        {
          stripeAccount: "acct_1",
          idempotencyKey: "sidian_checkout_rails_changed_cs_existing",
        },
      );
    },
  );

  it.each([
    ["objet", { object: "payment_intent" }],
    ["identifiant", { id: "cs_other" }],
    ["mode", { mode: "setup" }],
    ["référence tentative", { client_reference_id: "t-other" }],
    [
      "métadonnée tentative",
      {
        metadata: {
          sidian_creance_id: resolvedPayable().creance_id,
          sidian_tentative_id: "t-other",
        },
      },
    ],
    [
      "métadonnée créance",
      {
        metadata: {
          sidian_creance_id: "55555555-5555-4555-8555-555555555555",
          sidian_tentative_id: "t1",
        },
      },
    ],
    ["devise", { currency: "usd" }],
    ["montant", { amount_total: 11999 }],
    ["Customer figé", { customer: "cus_other" }],
    ["statut financier", { payment_status: "paid" }],
  ])(
    "identité divergente (%s) : fail-closed sans URL ni expiration",
    async (_label, sessionOverride) => {
      // Des rails volontairement divergents prouvent que l'identité est bien
      // contrôlée avant toute expiration de l'objet Stripe ambigu.
      mocks.eligibleRails = ["card"];
      const { admin } = makeAdmin({
        resolve_payment_link_by_token_hash: () => ({ data: resolvedPayable(), error: null }),
        claim_checkout_provisioning: () => alreadyCreatedClaim(),
      });
      const expire = vi.fn();
      const stripe = makeStripe({
        checkout: {
          sessions: {
            create: vi.fn(),
            retrieve: vi.fn(async () => reusablePaymentSession(sessionOverride)),
            expire,
          },
        },
      });

      const result = await createPaymentCheckoutSession({
        ...base,
        supabaseAdmin: admin,
        stripe,
      });

      expect(result).toEqual({ status: "retry" });
      expect(expire).not.toHaveBeenCalled();
    },
  );

  it("snapshot Customer local absent : refuse toute réutilisation de Session", async () => {
    const { admin } = makeAdmin({
      resolve_payment_link_by_token_hash: () => ({ data: resolvedPayable(), error: null }),
      claim_checkout_provisioning: () =>
        alreadyCreatedClaim({ stripe_customer_id: null }),
    });
    const expire = vi.fn();
    const stripe = makeStripe({
      checkout: {
        sessions: {
          create: vi.fn(),
          retrieve: vi.fn(async () => reusablePaymentSession()),
          expire,
        },
      },
    });

    await expect(
      createPaymentCheckoutSession({ ...base, supabaseAdmin: admin, stripe }),
    ).resolves.toEqual({ status: "retry" });
    expect(expire).not.toHaveBeenCalled();
  });

  it("paiement déjà en traitement (SEPA) → not_payable sans appel Stripe live", async () => {
    const { admin, rpc } = makeAdmin({
      resolve_payment_link_by_token_hash: () => ({
        data: resolvedPayable({ pending_payment: true }),
        error: null,
      }),
    });
    const result = await createPaymentCheckoutSession({
      ...base,
      supabaseAdmin: admin,
      stripe: makeStripe(),
    });
    expect(result).toEqual({ status: "not_payable", reason: "pending_payment" });
    expect(rpc).not.toHaveBeenCalledWith("claim_checkout_provisioning", expect.anything());
  });

  it("double clic : deux claims concurrents sur le même lien → un seul aboutit, l'autre patiente", async () => {
    // Simule deux soumissions quasi simultanées du bouton « Régler maintenant ».
    // Le navigateur n'est jamais l'arbitre : seul claim_checkout_provisioning
    // (sérialisé par créance, cf. 002-B) décide qui obtient la Session.
    let claimCount = 0;
    const { admin, rpc } = makeAdmin({
      resolve_payment_link_by_token_hash: () => ({ data: resolvedPayable(), error: null }),
      claim_checkout_provisioning: () => {
        claimCount += 1;
        if (claimCount === 1) {
          return {
            data: {
              status: "claimed",
              tentative_id: "t1",
              montant: 12000,
              idempotency_key: "sidian_checkout_x",
              lease_token: "lease-1",
            },
            error: null,
          };
        }
        return { data: { status: "in_progress" }, error: null };
      },
      complete_checkout_provisioning: () => ({ data: {}, error: null }),
    });
    const stripe = makeStripe();

    const [first, second] = await Promise.all([
      createPaymentCheckoutSession({ ...base, supabaseAdmin: admin, stripe }),
      createPaymentCheckoutSession({ ...base, supabaseAdmin: admin, stripe }),
    ]);

    const outcomes = [first, second].map((r) => r.status).sort();
    expect(outcomes).toEqual(["ready", "retry"]);
    expect(
      (stripe as { checkout: { sessions: { create: ReturnType<typeof vi.fn> } } }).checkout
        .sessions.create,
    ).toHaveBeenCalledTimes(1);
    expect(
      rpc.mock.calls.filter((call) => call[0] === "claim_checkout_provisioning"),
    ).toHaveLength(2);
  });

  it("échec Stripe pendant la création → fail_checkout_provisioning puis propagation", async () => {
    const failRpc = vi.fn(() => ({ data: {}, error: null }));
    const { admin, rpc } = makeAdmin({
      resolve_payment_link_by_token_hash: () => ({ data: resolvedPayable(), error: null }),
      claim_checkout_provisioning: () => ({
        data: {
          status: "claimed",
          tentative_id: "t1",
          montant: 12000,
          idempotency_key: "idem",
          lease_token: "lease-1",
        },
        error: null,
      }),
      fail_checkout_provisioning: failRpc,
    });
    const stripe = makeStripe({
      checkout: {
        sessions: {
          create: vi.fn(async () => {
            throw new StripeDomainError("stripe_card_error", undefined, "terminal");
          }),
          retrieve: vi.fn(),
        },
      },
    });
    await expect(
      createPaymentCheckoutSession({ ...base, supabaseAdmin: admin, stripe }),
    ).rejects.toMatchObject({ code: "stripe_card_error" });
    expect(rpc).toHaveBeenCalledWith(
      "fail_checkout_provisioning",
      expect.objectContaining({ p_tentative_id: "t1", p_retryable: false }),
    );
    expect(mocks.neutralize).toHaveBeenCalledWith(
      expect.objectContaining({
        tentativeId: "t1",
        checkoutLeaseToken: "lease-1",
        reason: "checkout_creation_failed_terminal",
      }),
    );
  });

  it("échec Stripe retryable → conserve la proposition stable pour le retry", async () => {
    const { admin, rpc } = makeAdmin({
      resolve_payment_link_by_token_hash: () => ({ data: resolvedPayable(), error: null }),
      claim_checkout_provisioning: () => ({
        data: {
          status: "claimed",
          tentative_id: "t1",
          montant: 12000,
          idempotency_key: "idem",
          lease_token: "lease-1",
        },
        error: null,
      }),
      fail_checkout_provisioning: () => ({ data: {}, error: null }),
    });
    const stripe = makeStripe({
      checkout: {
        sessions: {
          create: vi.fn(async () => {
            throw new StripeDomainError(
              "stripe_network_error",
              undefined,
              "retryable",
            );
          }),
          retrieve: vi.fn(),
        },
      },
    });

    await expect(
      createPaymentCheckoutSession({ ...base, supabaseAdmin: admin, stripe }),
    ).rejects.toMatchObject({ code: "stripe_network_error" });
    expect(rpc).toHaveBeenCalledWith(
      "fail_checkout_provisioning",
      expect.objectContaining({ p_tentative_id: "t1", p_retryable: true }),
    );
    expect(mocks.neutralize).not.toHaveBeenCalled();
  });
});

describe("resolvePaymentLinkForDisplay", () => {
  it("lien payable → display payable, sans créer de Session", async () => {
    const { admin, rpc } = makeAdmin({
      resolve_payment_link_by_token_hash: () => ({ data: resolvedPayable(), error: null }),
    });
    const result = await resolvePaymentLinkForDisplay({
      supabaseAdmin: admin,
      rawToken: RAW_TOKEN,
      clientIp: "203.0.113.1",
    });
    expect(result).toMatchObject({
      status: "display",
      payable: true,
      montant: 12000,
      amountPaid: 0,
      devise: "EUR",
      availableRails: ["card", "sepa_core"],
    });
    expect(rpc).not.toHaveBeenCalledWith(
      "claim_checkout_provisioning",
      expect.anything(),
    );
  });

  it("expose les champs d'affichage public (nom prestataire, libellé, référence, échéance)", async () => {
    const { admin } = makeAdmin({
      resolve_payment_link_by_token_hash: () => ({
        data: resolvedPayable({
          prestataire_nom: "Agence Exemple",
          creance_libelle: "Mission juillet",
          creance_reference_externe: "FA-2026-042",
          creance_date_echeance: "2026-08-01",
        }),
        error: null,
      }),
    });
    const result = await resolvePaymentLinkForDisplay({
      supabaseAdmin: admin,
      rawToken: RAW_TOKEN,
      clientIp: "203.0.113.1",
    });
    expect(result).toMatchObject({
      status: "display",
      prestataireNom: "Agence Exemple",
      libelle: "Mission juillet",
      referenceExterne: "FA-2026-042",
      dateEcheance: "2026-08-01",
    });
  });

  it("card active / SEPA inactive → affiche uniquement la carte", async () => {
    mocks.eligibleRails = ["card"];
    const { admin } = makeAdmin({
      resolve_payment_link_by_token_hash: () => ({
        data: resolvedPayable(),
        error: null,
      }),
    });

    const result = await resolvePaymentLinkForDisplay({
      supabaseAdmin: admin,
      rawToken: RAW_TOKEN,
      clientIp: "203.0.113.1",
    });

    expect(result).toMatchObject({
      status: "display",
      payable: true,
      availableRails: ["card"],
    });
  });

  it("aucun rail actif → affichage non payable avant toute action", async () => {
    mocks.eligibleRails = [];
    const { admin } = makeAdmin({
      resolve_payment_link_by_token_hash: () => ({
        data: resolvedPayable(),
        error: null,
      }),
    });

    const result = await resolvePaymentLinkForDisplay({
      supabaseAdmin: admin,
      rawToken: RAW_TOKEN,
      clientIp: "203.0.113.1",
    });

    expect(result).toMatchObject({
      status: "display",
      payable: false,
      reason: "account_not_payable",
      availableRails: [],
    });
  });

  it("revérification Stripe indisponible → fail-closed avec état explicite", async () => {
    mocks.eligibleThrows = new StripeDomainError(
      "stripe_account_retrieve_failed",
      undefined,
      "retryable",
    );
    const { admin } = makeAdmin({
      resolve_payment_link_by_token_hash: () => ({
        data: resolvedPayable(),
        error: null,
      }),
    });

    const result = await resolvePaymentLinkForDisplay({
      supabaseAdmin: admin,
      rawToken: RAW_TOKEN,
      clientIp: "203.0.113.1",
    });

    expect(result).toMatchObject({
      status: "display",
      payable: false,
      reason: "account_check_unavailable",
      availableRails: [],
    });
  });

  it("créance déjà réglée → display non payable (settled)", async () => {
    const { admin } = makeAdmin({
      resolve_payment_link_by_token_hash: () => ({
        data: resolvedPayable({ remaining: 0, creance_etat: "REGLEE" }),
        error: null,
      }),
    });
    const result = await resolvePaymentLinkForDisplay({
      supabaseAdmin: admin,
      rawToken: RAW_TOKEN,
      clientIp: "203.0.113.1",
    });
    expect(result).toMatchObject({ status: "display", payable: false, reason: "settled" });
  });

  it("solde nul sans créance terminale → display non payable (settled)", async () => {
    const { admin } = makeAdmin({
      resolve_payment_link_by_token_hash: () => ({
        data: resolvedPayable({ remaining: 0 }),
        error: null,
      }),
    });
    const result = await resolvePaymentLinkForDisplay({
      supabaseAdmin: admin,
      rawToken: RAW_TOKEN,
      clientIp: "203.0.113.1",
    });
    expect(result).toMatchObject({ status: "display", payable: false, reason: "settled" });
  });

  it("compte Stripe non configuré → display non payable (account_not_configured)", async () => {
    const { admin } = makeAdmin({
      resolve_payment_link_by_token_hash: () => ({
        data: resolvedPayable({ stripe_account_id: null }),
        error: null,
      }),
    });
    const result = await resolvePaymentLinkForDisplay({
      supabaseAdmin: admin,
      rawToken: RAW_TOKEN,
      clientIp: "203.0.113.1",
    });
    expect(result).toMatchObject({
      status: "display",
      payable: false,
      reason: "account_not_configured",
    });
  });

  it("paiement en cours (SEPA) → display non payable (pending_payment), moyen exposé", async () => {
    const { admin } = makeAdmin({
      resolve_payment_link_by_token_hash: () => ({
        data: resolvedPayable({ pending_payment: true, pending_moyen: "sepa_core" }),
        error: null,
      }),
    });
    const result = await resolvePaymentLinkForDisplay({
      supabaseAdmin: admin,
      rawToken: RAW_TOKEN,
      clientIp: "203.0.113.1",
    });
    expect(result).toMatchObject({
      status: "display",
      payable: false,
      reason: "pending_payment",
      pendingMoyen: "sepa_core",
    });
  });

  it("lien invalide (jamais émis) → not_found", async () => {
    const { admin } = makeAdmin({
      resolve_payment_link_by_token_hash: () => ({ data: { found: false }, error: null }),
    });
    const result = await resolvePaymentLinkForDisplay({
      supabaseAdmin: admin,
      rawToken: RAW_TOKEN,
      clientIp: "203.0.113.1",
    });
    expect(result).toEqual({ status: "not_found" });
  });

  it("quota d'ouverture dépassé → rate_limited link_resolution_ip", async () => {
    mocks.rateDecision = { allowed: false, remaining: 0, reset_at: null };
    const { admin } = makeAdmin({});
    const result = await resolvePaymentLinkForDisplay({
      supabaseAdmin: admin,
      rawToken: RAW_TOKEN,
      clientIp: "203.0.113.1",
    });
    expect(result).toEqual({
      status: "rate_limited",
      category: "link_resolution_ip",
      resetAt: null,
    });
  });
});
