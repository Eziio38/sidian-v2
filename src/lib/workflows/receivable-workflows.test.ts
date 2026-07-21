import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import { cancelPaymentReceivableSafely } from "./receivable-workflows";

const RECEIVABLE_ID = "11111111-1111-4111-8111-111111111111";
const PRESTATAIRE_ID = "22222222-2222-4222-8222-222222222222";
const ATTEMPT_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "cs_test_sidian_1";
const PAYMENT_INTENT_ID = "pi_test_sidian_1";
const ACCOUNT_ID = "acct_sidian_1";

type SessionStatus = "open" | "complete" | "expired";

function stripeSession(
  status: SessionStatus,
  overrides: Partial<Stripe.Checkout.Session> = {},
): Stripe.Checkout.Session {
  return {
    id: SESSION_ID,
    object: "checkout.session",
    mode: "payment",
    status,
    payment_status: status === "expired" ? "unpaid" : "unpaid",
    currency: "eur",
    client_reference_id: ATTEMPT_ID,
    metadata: {
      sidian_creance_id: RECEIVABLE_ID,
      sidian_tentative_id: ATTEMPT_ID,
    },
    payment_intent: PAYMENT_INTENT_ID,
    ...overrides,
  } as Stripe.Checkout.Session;
}

function makeSupabase(options?: {
  attemptState?: "CREEE" | "ECHOUEE" | "ANNULEE";
  attemptAccountId?: string | null;
  providerAccountId?: string | null;
  rpcError?: { message: string } | null;
}) {
  const attempt = {
    id: ATTEMPT_ID,
    etat: options?.attemptState ?? "ECHOUEE",
    stripe_account_id:
      options && "attemptAccountId" in options
        ? options.attemptAccountId
        : ACCOUNT_ID,
    stripe_checkout_session_id: SESSION_ID,
    stripe_payment_intent_id: PAYMENT_INTENT_ID,
  };
  const attemptsOrder = vi.fn(async () => ({ data: [attempt], error: null }));
  const rpc = vi.fn(async () => ({
    data: options?.rpcError ? null : { changed: true },
    error: options?.rpcError ?? null,
  }));

  const from = vi.fn((table: string) => {
    if (table === "creance") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: { id: RECEIVABLE_ID, prestataire_id: PRESTATAIRE_ID },
              error: null,
            })),
          })),
        })),
      };
    }
    if (table === "prestataire") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: {
                stripe_account_id:
                  options && "providerAccountId" in options
                    ? options.providerAccountId
                    : ACCOUNT_ID,
              },
              error: null,
            })),
          })),
        })),
      };
    }
    if (table === "tentative_paiement") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            not: vi.fn(() => ({ order: attemptsOrder })),
          })),
        })),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return { supabase: { from, rpc } as never, rpc };
}

function makeStripe(initial: Stripe.Checkout.Session | Error) {
  let current = initial;
  const retrieve = vi.fn(async () => {
    if (current instanceof Error) throw current;
    return current;
  });
  const expire = vi.fn(async () => {
    if (current instanceof Error) throw current;
    current = stripeSession("expired");
    return current;
  });
  return {
    stripe: { checkout: { sessions: { retrieve, expire } } } as never,
    retrieve,
    expire,
  };
}

describe("annulation avec réconciliation Stripe", () => {
  it("expire une Session open malgré une tentative locale ECHOUEE avant la RPC", async () => {
    const { supabase, rpc } = makeSupabase({ attemptState: "ECHOUEE" });
    const { stripe, retrieve, expire } = makeStripe(stripeSession("open"));

    await cancelPaymentReceivableSafely(supabase, RECEIVABLE_ID, { stripe });

    expect(retrieve).toHaveBeenCalledWith(
      SESSION_ID,
      {},
      { stripeAccount: ACCOUNT_ID },
    );
    expect(expire).toHaveBeenCalledWith(
      SESSION_ID,
      {},
      {
        stripeAccount: ACCOUNT_ID,
        idempotencyKey: `sidian_cancel_checkout_${SESSION_ID}`,
      },
    );
    expect(expire.mock.invocationCallOrder[0]).toBeLessThan(
      rpc.mock.invocationCallOrder[0],
    );
    expect(rpc).toHaveBeenCalledWith("cancel_current_payment_receivable", {
      p_creance_id: RECEIVABLE_ID,
    });
  });

  it("accepte une Session Stripe déjà expirée et explicitement impayée", async () => {
    const { supabase, rpc } = makeSupabase({ attemptState: "ANNULEE" });
    const { stripe, expire } = makeStripe(stripeSession("expired"));

    await cancelPaymentReceivableSafely(supabase, RECEIVABLE_ID, { stripe });

    expect(expire).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("refuse fermé un compte local incohérent sans appeler Stripe ni SQL", async () => {
    const { supabase, rpc } = makeSupabase({
      attemptAccountId: "acct_other",
    });
    const { stripe, retrieve } = makeStripe(stripeSession("open"));

    await expect(
      cancelPaymentReceivableSafely(supabase, RECEIVABLE_ID, { stripe }),
    ).rejects.toMatchObject({ code: "stripe_connected_scope_mismatch" });
    expect(retrieve).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuse fermé une identité Session incohérente ou une erreur Stripe", async () => {
    const mismatch = makeSupabase();
    const mismatchedStripe = makeStripe(
      stripeSession("open", {
        metadata: {
          sidian_creance_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          sidian_tentative_id: ATTEMPT_ID,
        },
      }),
    );

    await expect(
      cancelPaymentReceivableSafely(mismatch.supabase, RECEIVABLE_ID, {
        stripe: mismatchedStripe.stripe,
      }),
    ).rejects.toMatchObject({
      code: "payment_receivable_stripe_identity_mismatch",
    });
    expect(mismatch.rpc).not.toHaveBeenCalled();

    const unavailable = makeSupabase();
    const unavailableStripe = makeStripe(new Error("network secret"));
    await expect(
      cancelPaymentReceivableSafely(unavailable.supabase, RECEIVABLE_ID, {
        stripe: unavailableStripe.stripe,
      }),
    ).rejects.toMatchObject({
      code: "payment_receivable_stripe_reconciliation_failed",
    });
    expect(unavailable.rpc).not.toHaveBeenCalled();
  });

  it("refuse une Session complete car elle ne prouve pas l'absence de fonds", async () => {
    const { supabase, rpc } = makeSupabase();
    const { stripe, expire } = makeStripe(
      stripeSession("complete", { payment_status: "paid" }),
    );

    await expect(
      cancelPaymentReceivableSafely(supabase, RECEIVABLE_ID, { stripe }),
    ).rejects.toMatchObject({
      code: "payment_receivable_stripe_session_not_safely_terminal",
    });
    expect(expire).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reste idempotente sur un double appel et n'expire Stripe qu'une fois", async () => {
    const { supabase, rpc } = makeSupabase({ attemptState: "ECHOUEE" });
    const { stripe, expire } = makeStripe(stripeSession("open"));

    await cancelPaymentReceivableSafely(supabase, RECEIVABLE_ID, { stripe });
    await cancelPaymentReceivableSafely(supabase, RECEIVABLE_ID, { stripe });

    expect(expire).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
