import { beforeEach, describe, expect, it, vi } from "vitest";

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.generated";

const mocks = vi.hoisted(() => ({
  getSidianBillingReadiness: vi.fn(() => ({
    enabled: true,
    secretKey: "sk_test_x",
    priceId: "price_x",
    webhookSecret: "whsec_billing",
    mode: "test" as const,
    environment: "local" as const,
    earlyAccessLockMonths: null as number | null,
  })),
  constructEvent: vi.fn(),
}));

vi.mock("@/lib/stripe/billing/env", () => ({
  getSidianBillingReadiness: mocks.getSidianBillingReadiness,
}));
vi.mock("@/lib/stripe/billing/client", () => ({
  getSidianBillingStripeClient: () => ({
    webhooks: { constructEvent: mocks.constructEvent },
  }),
}));

import {
  processSidianBillingWebhookEvent,
  tryProcessSidianBillingWebhookRequest,
  tryVerifySidianBillingWebhookEvent,
} from "@/lib/stripe/billing/process";

type RpcCall = { name: string; args: Record<string, unknown> };

function fakeSupabase(options: {
  claim?: Record<string, unknown>;
  apply?: { data?: unknown; error?: { message: string } | null };
  calls: RpcCall[];
}) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    options.calls.push({ name, args });
    if (name === "claim_stripe_webhook_event") {
      return {
        data: options.claim ?? {
          claimed: true,
          status: "processing",
          terminal: false,
          attempt: 1,
          lease_token: "11111111-1111-4111-8111-111111111111",
        },
        error: null,
      };
    }
    if (name === "renew_stripe_webhook_event_lease") {
      return { data: { id: "evt" }, error: null };
    }
    if (name === "mark_stripe_webhook_event_status") {
      return { data: { id: "evt" }, error: null };
    }
    return {
      data: options.apply?.data ?? { applied: true },
      error: options.apply?.error ?? null,
    };
  });
  return { rpc } as unknown as SupabaseClient<Database>;
}

function subscriptionEvent(type: string): Stripe.Event {
  return {
    id: "evt_1",
    type,
    created: 1_785_000_000,
    data: {
      object: {
        object: "subscription",
        id: "sub_1",
        customer: "cus_1",
        status: "active",
        cancel_at_period_end: false,
        items: { data: [{ current_period_end: 1_787_000_000, price: { id: "price_1" } }] },
      },
    },
  } as unknown as Stripe.Event;
}

describe("tryVerifySidianBillingWebhookEvent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retourne null sans en-tête de signature", () => {
    expect(
      tryVerifySidianBillingWebhookEvent({
        rawBody: "{}",
        signatureHeader: null,
      }),
    ).toBeNull();
    expect(mocks.constructEvent).not.toHaveBeenCalled();
  });

  it("retourne null quand la facturation n'est pas configurée", () => {
    mocks.getSidianBillingReadiness.mockReturnValueOnce({
      enabled: false,
      reason: "not_configured",
    } as never);

    expect(
      tryVerifySidianBillingWebhookEvent({
        rawBody: "{}",
        signatureHeader: "sig",
      }),
    ).toBeNull();
  });

  it("retourne null — sans lever — sur une signature invalide", () => {
    mocks.constructEvent.mockImplementationOnce(() => {
      throw new Error("No signatures found matching the expected signature");
    });

    expect(
      tryVerifySidianBillingWebhookEvent({
        rawBody: "{}",
        signatureHeader: "sig_connect",
      }),
    ).toBeNull();
  });

  it("utilise le secret FACTURATION, jamais celui de Connect", () => {
    mocks.constructEvent.mockReturnValueOnce(
      subscriptionEvent("customer.subscription.updated"),
    );

    tryVerifySidianBillingWebhookEvent({
      rawBody: "{}",
      signatureHeader: "sig",
    });

    expect(mocks.constructEvent).toHaveBeenCalledWith(
      "{}",
      "sig",
      "whsec_billing",
    );
  });
});

describe("processSidianBillingWebhookEvent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("réutilise le claim, le lease et le marquage existants", async () => {
    const calls: RpcCall[] = [];
    const supabase = fakeSupabase({ calls });

    const result = await processSidianBillingWebhookEvent({
      event: subscriptionEvent("customer.subscription.created"),
      supabaseAdmin: supabase,
    });

    expect(result).toEqual({ httpStatus: 200, body: { received: true } });
    expect(calls.map((call) => call.name)).toEqual([
      "claim_stripe_webhook_event",
      "renew_stripe_webhook_event_lease",
      "apply_sidian_subscription_event",
      "mark_stripe_webhook_event_status",
    ]);
    // Facturation = compte plateforme : aucun compte connecté n'est déclaré.
    expect(calls[0]?.args.p_stripe_connected_account_id).toBeUndefined();
    expect(calls[3]?.args.p_status).toBe("processed");
  });

  it("acquitte un doublon terminal sans rejouer l'effet", async () => {
    const calls: RpcCall[] = [];
    const supabase = fakeSupabase({
      calls,
      claim: { claimed: false, status: "processed", terminal: true },
    });

    const result = await processSidianBillingWebhookEvent({
      event: subscriptionEvent("customer.subscription.updated"),
      supabaseAdmin: supabase,
    });

    expect(result).toEqual({
      httpStatus: 200,
      body: { received: true, duplicate: true },
    });
    expect(calls).toHaveLength(1);
  });

  it("demande un rejeu quand le lease est encore détenu ailleurs", async () => {
    const calls: RpcCall[] = [];
    const supabase = fakeSupabase({
      calls,
      claim: { claimed: false, status: "processing", terminal: false },
    });

    const result = await processSidianBillingWebhookEvent({
      event: subscriptionEvent("customer.subscription.updated"),
      supabaseAdmin: supabase,
    });

    expect(result.httpStatus).toBe(503);
    expect(result.body.retryable).toBe(true);
  });

  it("marque 'ignored' un événement déjà appliqué", async () => {
    const calls: RpcCall[] = [];
    const supabase = fakeSupabase({
      calls,
      apply: { data: { applied: false, reason: "already_applied" } },
    });

    await processSidianBillingWebhookEvent({
      event: subscriptionEvent("customer.subscription.updated"),
      supabaseAdmin: supabase,
    });

    const mark = calls.find(
      (call) => call.name === "mark_stripe_webhook_event_status",
    );
    expect(mark?.args.p_status).toBe("ignored");
    expect(mark?.args.p_error_code).toBe("already_applied");
  });

  it("échoue en terminal — sans rejeu — sur une violation d'identité", async () => {
    const calls: RpcCall[] = [];
    const supabase = fakeSupabase({
      calls,
      apply: { error: { message: "billing_subscription_identity_mismatch" } },
    });

    const result = await processSidianBillingWebhookEvent({
      event: subscriptionEvent("customer.subscription.updated"),
      supabaseAdmin: supabase,
    });

    expect(result).toEqual({ httpStatus: 200, body: { received: true } });
    const mark = calls.find(
      (call) => call.name === "mark_stripe_webhook_event_status",
    );
    expect(mark?.args.p_status).toBe("failed_terminal");
  });

  it("propage la durée de verrouillage Early Access configurée", async () => {
    const calls: RpcCall[] = [];
    mocks.getSidianBillingReadiness.mockReturnValueOnce({
      enabled: true,
      secretKey: "sk_test_x",
      priceId: "price_x",
      webhookSecret: "whsec_billing",
      mode: "test",
      environment: "local",
      earlyAccessLockMonths: 12,
    } as never);

    await processSidianBillingWebhookEvent({
      event: subscriptionEvent("customer.subscription.created"),
      supabaseAdmin: fakeSupabase({ calls }),
    });

    const apply = calls.find(
      (call) => call.name === "apply_sidian_subscription_event",
    );
    expect(apply?.args.p_early_access_lock_months).toBe(12);
  });

  it("n'enregistre aucune promesse tarifaire sans décision configurée", async () => {
    const calls: RpcCall[] = [];

    await processSidianBillingWebhookEvent({
      event: subscriptionEvent("customer.subscription.created"),
      supabaseAdmin: fakeSupabase({ calls }),
    });

    const apply = calls.find(
      (call) => call.name === "apply_sidian_subscription_event",
    );
    expect(apply?.args.p_early_access_lock_months).toBeUndefined();
  });
});

describe("tryProcessSidianBillingWebhookRequest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rend la main au chemin Connect si la signature n'est pas la sienne", async () => {
    mocks.constructEvent.mockImplementationOnce(() => {
      throw new Error("signature mismatch");
    });

    await expect(
      tryProcessSidianBillingWebhookRequest({
        rawBody: "{}",
        signatureHeader: "sig_connect",
        supabaseAdmin: fakeSupabase({ calls: [] }),
      }),
    ).resolves.toBeNull();
  });

  it("acquitte sans effet un type hors périmètre signé facturation", async () => {
    const calls: RpcCall[] = [];
    mocks.constructEvent.mockReturnValueOnce({
      id: "evt_x",
      type: "payment_intent.succeeded",
      created: 1_785_000_000,
      data: { object: {} },
    } as unknown as Stripe.Event);

    await expect(
      tryProcessSidianBillingWebhookRequest({
        rawBody: "{}",
        signatureHeader: "sig",
        supabaseAdmin: fakeSupabase({ calls }),
      }),
    ).resolves.toEqual({ httpStatus: 200, body: { received: true } });
    expect(calls).toHaveLength(0);
  });

  it("traite un événement d'abonnement signé facturation", async () => {
    const calls: RpcCall[] = [];
    mocks.constructEvent.mockReturnValueOnce(
      subscriptionEvent("customer.subscription.deleted"),
    );

    const result = await tryProcessSidianBillingWebhookRequest({
      rawBody: "{}",
      signatureHeader: "sig",
      supabaseAdmin: fakeSupabase({ calls }),
    });

    expect(result).toEqual({ httpStatus: 200, body: { received: true } });
    expect(
      calls.some((call) => call.name === "apply_sidian_subscription_event"),
    ).toBe(true);
  });
});
