import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const writerMocks = vi.hoisted(() => {
  const rpc = vi.fn(async () => ({
    data: { id: "binding_1" },
    error: null,
  }));
  return {
    rpc,
    createClient: vi.fn(() => ({ rpc })),
  };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: writerMocks.createClient,
}));

import { createConnectedAccountLink } from "@/lib/stripe/connect/create-account-link";
import { ensureConnectedAccountForCurrentPrestataire } from "@/lib/stripe/connect/ensure-connected-account";
import { replaceStripeCustomerBinding } from "@/lib/stripe/customers/bindings";

process.env.NEXT_PUBLIC_APP_URL = "http://127.0.0.1:3000";
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "local-test-key";
process.env.NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED = "true";
process.env.SIDIAN_ENVIRONMENT = "local";
process.env.STRIPE_MODE = "test";
process.env.STRIPE_SECRET_KEY = "sk_test_example";
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_example";
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = "whsec_example";
process.env.SUPABASE_STRIPE_BINDING_WRITER_JWT = [
  Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT" })).toString("base64url"),
  Buffer.from(
    JSON.stringify({
      role: "stripe_customer_binding_writer",
      sidian_environment: "local",
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString("base64url"),
  "test-signature",
].join(".");

const operationKey = "11111111-1111-4111-8111-111111111111";

function validAccount(
  overrides: Record<string, unknown> = {},
): Stripe.Account {
  return {
    id: "acct_new",
    object: "account",
    type: "express",
    country: "FR",
    charges_enabled: false,
    payouts_enabled: false,
    details_submitted: false,
    email: null,
    controller: {
      type: "application",
      requirement_collection: "stripe",
      stripe_dashboard: { type: "express" },
    },
    capabilities: {
      card_payments: "pending",
      sepa_debit_payments: "pending",
    },
    requirements: {},
    metadata: {
      sidian_prestataire_id: "prest_1",
      sidian_environment: "local",
      sidian_provisioning_operation_id: operationKey,
    },
    ...overrides,
  } as unknown as Stripe.Account;
}

function userClient(prestataire: Record<string, unknown> | null) {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "user_1" } },
        error: null,
      })),
    },
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: table === "prestataire" ? prestataire : { id: "client_1" },
            error: prestataire ? null : { message: "not found" },
          })),
        })),
      })),
    })),
  };
}

function noOtherPrestataireQuery(other: Record<string, unknown> | null = null) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        neq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: other, error: null })),
        })),
      })),
    })),
  };
}

describe("Account Link tenant-safe", () => {
  it("dérive le compte de la session et valide son identité complète", async () => {
    const stripe = {
      accounts: { retrieve: vi.fn(async () => validAccount({ id: "acct_1" })) },
      accountLinks: { create: vi.fn(async (input) => input) },
    };
    const result = await createConnectedAccountLink({
      supabaseUser: userClient({
        id: "prest_1",
        stripe_account_id: "acct_1",
        stripe_connect_operation_key: operationKey,
      }) as never,
      stripe: stripe as unknown as Stripe,
      sidianEnvironment: "local",
    });
    expect(result).toMatchObject({ account: "acct_1" });
  });

  it("refuse une session absente ou un compte incompatible", async () => {
    await expect(
      createConnectedAccountLink({
        supabaseUser: {
          auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) },
        } as never,
        stripe: {} as Stripe,
        sidianEnvironment: "local",
      }),
    ).rejects.toMatchObject({ code: "not_authenticated" });

    const stripe = {
      accounts: {
        retrieve: vi.fn(async () =>
          validAccount({
            id: "acct_1",
            metadata: {
              sidian_prestataire_id: "prest_other",
              sidian_environment: "local",
              sidian_provisioning_operation_id: operationKey,
            },
          }),
        ),
      },
    };
    await expect(
      createConnectedAccountLink({
        supabaseUser: userClient({
          id: "prest_1",
          stripe_account_id: "acct_1",
          stripe_connect_operation_key: operationKey,
        }) as never,
        stripe: stripe as unknown as Stripe,
        sidianEnvironment: "local",
      }),
    ).rejects.toMatchObject({ code: "stripe_account_scope_mismatch" });
  });
});

describe("Customer binding tenant-safe", () => {
  const customerMetadata = {
    sidian_prestataire_id: "prest_1",
    sidian_client_payeur_id: "client_1",
    sidian_environment: "local",
  };

  async function bind(customer: Record<string, unknown>) {
    writerMocks.rpc.mockClear();
    writerMocks.createClient.mockClear();
    const stripe = {
      customers: { retrieve: vi.fn(async () => customer) },
    };
    const promise = replaceStripeCustomerBinding({
      supabaseUser: userClient({ id: "prest_1", stripe_account_id: "acct_1" }) as never,
      clientPayeurId: "client_1",
      stripeCustomerId: "cus_1",
      stripe: stripe as unknown as Stripe,
      sidianEnvironment: "local",
    });
    return { promise, rpc: writerMocks.rpc, stripe };
  }

  it("accepte uniquement les métadonnées exactes dans le compte dérivé", async () => {
    const { promise, rpc, stripe } = await bind({
      id: "cus_1",
      deleted: false,
      metadata: customerMetadata,
    });
    await promise;
    expect(stripe.customers.retrieve).toHaveBeenCalledWith(
      "cus_1",
      {},
      { stripeAccount: "acct_1" },
    );
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(
      "replace_verified_stripe_customer_binding",
      {
        p_prestataire_id: "prest_1",
        p_client_payeur_id: "client_1",
        p_stripe_account_id: "acct_1",
        p_stripe_customer_id: "cus_1",
        p_sidian_environment: "local",
      },
    );
  });

  it.each([
    { id: "cus_1", deleted: true, metadata: customerMetadata },
    { id: "cus_other", deleted: false, metadata: customerMetadata },
    { id: "cus_1", deleted: false, metadata: {} },
    { id: "cus_1", deleted: false, metadata: { ...customerMetadata, sidian_prestataire_id: "prest_2" } },
    { id: "cus_1", deleted: false, metadata: { ...customerMetadata, sidian_client_payeur_id: "client_2" } },
    { id: "cus_1", deleted: false, metadata: { ...customerMetadata, sidian_environment: "staging" } },
  ])("refuse Customer supprimé, absent ou mal scopé", async (customer) => {
    const { promise, rpc } = await bind(customer);
    await expect(promise).rejects.toMatchObject({
      code: "stripe_customer_not_found_in_connected_account",
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(writerMocks.createClient).not.toHaveBeenCalled();
  });

  it("refuse un bon ID absent du compte Connect dérivé", async () => {
    await expect(
      replaceStripeCustomerBinding({
        supabaseUser: userClient({
          id: "prest_1",
          stripe_account_id: "acct_1",
        }) as never,
        clientPayeurId: "client_1",
        stripeCustomerId: "cus_1",
        stripe: {
          customers: {
            retrieve: vi.fn(async () => {
              throw new Error("resource_missing");
            }),
          },
        } as unknown as Stripe,
        sidianEnvironment: "local",
      }),
    ).rejects.toMatchObject({
      code: "stripe_customer_not_found_in_connected_account",
    });
  });
});

describe("provisioning Connect durable", () => {
  const claimed = {
    id: "prest_1",
    email: "owner@example.com",
    stripe_account_id: null,
    stripe_connect_operation_key: operationKey,
    stripe_connect_idempotency_key: "sidian_connect_persisted",
  };

  function clients(options: {
    claimedRow?: Record<string, unknown>;
    completionError?: unknown;
    flushError?: unknown;
    otherPrestataire?: Record<string, unknown> | null;
  } = {}) {
    const userRpc = vi.fn(async () => ({
      data: options.claimedRow ?? claimed,
      error: null,
    }));
    const adminRpc = vi.fn(async (name: string) => {
      if (name === "complete_prestataire_connect_provisioning") {
        return {
          data: options.completionError
            ? null
            : { ...claimed, stripe_account_id: "acct_new" },
          error: options.completionError ?? null,
        };
      }
      if (name === "flush_stripe_connect_audit_outbox") {
        return {
          data: options.flushError ? null : { status: "delivered" },
          error: options.flushError ?? null,
        };
      }
      return { data: {}, error: null };
    });
    return {
      user: { rpc: userRpc },
      admin: {
        rpc: adminRpc,
        from: vi.fn(() => noOtherPrestataireQuery(options.otherPrestataire)),
      },
      adminRpc,
    };
  }

  function stripe(listed: Stripe.Account[] = []) {
    return {
      accounts: {
        list: vi.fn(async () => ({ data: listed, has_more: false })),
        create: vi.fn(async () => validAccount()),
        retrieve: vi.fn(async () => validAccount()),
      },
    } as unknown as Stripe;
  }

  it("réutilise la clé persistée et pose les métadonnées stables", async () => {
    const db = clients();
    const stripeClient = stripe();
    const result = await ensureConnectedAccountForCurrentPrestataire({
      supabaseUser: db.user as never,
      supabaseAdmin: db.admin as never,
      stripe: stripeClient,
      sidianEnvironment: "local",
    });
    expect(result.created).toBe(true);
    expect(stripeClient.accounts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilities: expect.objectContaining({
          sepa_debit_payments: { requested: true },
        }),
        metadata: {
          sidian_prestataire_id: "prest_1",
          sidian_environment: "local",
          sidian_provisioning_operation_id: operationKey,
        },
      }),
      { idempotencyKey: "sidian_connect_persisted" },
    );
    expect(db.adminRpc).toHaveBeenCalledWith(
      "complete_prestataire_connect_provisioning",
      expect.objectContaining({ p_audit_action: "stripe.connect.account_created" }),
    );
    expect(db.adminRpc).toHaveBeenCalledWith(
      "flush_stripe_connect_audit_outbox",
      expect.any(Object),
    );
  });

  it("réconcilie exactement un compte compatible sans en créer un second", async () => {
    const recovered = validAccount({ id: "acct_recovered" });
    const db = clients();
    const stripeClient = stripe([recovered]);
    const result = await ensureConnectedAccountForCurrentPrestataire({
      supabaseUser: db.user as never,
      supabaseAdmin: db.admin as never,
      stripe: stripeClient,
      sidianEnvironment: "local",
    });
    expect(result.created).toBe(false);
    expect(stripeClient.accounts.create).not.toHaveBeenCalled();
  });

  it.each([
    [[validAccount(), validAccount({ id: "acct_2" })], "connect_reconciliation_multiple_accounts"],
    [[validAccount({ type: "standard" })], "connect_reconciliation_account_incompatible"],
    [[validAccount({ country: "US" })], "connect_reconciliation_account_incompatible"],
    [[validAccount({ controller: { type: "account" } })], "connect_reconciliation_account_incompatible"],
    [[validAccount({ deleted: true })], "connect_reconciliation_account_deleted"],
    [[validAccount({ metadata: { sidian_prestataire_id: "prest_2", sidian_environment: "local", sidian_provisioning_operation_id: operationKey } })], "connect_reconciliation_metadata_mismatch"],
    [[validAccount({ metadata: { sidian_prestataire_id: "prest_1", sidian_environment: "staging", sidian_provisioning_operation_id: operationKey } })], "connect_reconciliation_metadata_mismatch"],
  ])("refuse ambiguïté ou compte incompatible", async (listed, code) => {
    const db = clients();
    await expect(
      ensureConnectedAccountForCurrentPrestataire({
        supabaseUser: db.user as never,
        supabaseAdmin: db.admin as never,
        stripe: stripe(listed as Stripe.Account[]),
        sidianEnvironment: "local",
      }),
    ).rejects.toMatchObject({ code });
    expect(db.adminRpc).toHaveBeenCalledWith(
      "fail_prestataire_connect_provisioning",
      expect.objectContaining({ p_retryable: false }),
    );
  });

  it("refuse un compte déjà attaché à un autre prestataire", async () => {
    const db = clients({ otherPrestataire: { id: "prest_2" } });
    await expect(
      ensureConnectedAccountForCurrentPrestataire({
        supabaseUser: db.user as never,
        supabaseAdmin: db.admin as never,
        stripe: stripe([validAccount()]),
        sidianEnvironment: "local",
      }),
    ).rejects.toMatchObject({
      code: "connect_account_attached_to_other_prestataire",
    });
  });

  it("remonte une panne DB après succès Stripe pour permettre la réconciliation", async () => {
    const db = clients({ completionError: { message: "db down" } });
    await expect(
      ensureConnectedAccountForCurrentPrestataire({
        supabaseUser: db.user as never,
        supabaseAdmin: db.admin as never,
        stripe: stripe(),
        sidianEnvironment: "local",
      }),
    ).rejects.toMatchObject({ code: "connect_completion_persistence_failed" });
  });

  it("reprend une outbox d'audit sur un compte déjà finalisé", async () => {
    const db = clients({
      claimedRow: { ...claimed, stripe_account_id: "acct_new" },
    });
    await ensureConnectedAccountForCurrentPrestataire({
      supabaseUser: db.user as never,
      supabaseAdmin: db.admin as never,
      stripe: stripe(),
      sidianEnvironment: "local",
    });
    expect(db.adminRpc).toHaveBeenCalledWith(
      "flush_stripe_connect_audit_outbox",
      expect.objectContaining({ p_operation_key: operationKey }),
    );
  });
});
