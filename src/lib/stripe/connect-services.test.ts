import { describe, expect, it, vi } from "vitest";

import {
  assertConnectedAccountEligibleForPaymentRail,
  assertConnectedAccountPayable,
} from "@/lib/stripe/connect/retrieve-and-sync";
import { StripeDomainError } from "@/lib/stripe/shared/errors";
import { dispatchStripeWebhookEvent } from "@/lib/stripe/webhooks/dispatch";
import { processStripeWebhookRequest } from "@/lib/stripe/webhooks/process";
import Stripe from "stripe";

describe("assertConnectedAccountPayable", () => {
  it("refuse un compte non payable après revérification live", async () => {
    const stripe = {
      accounts: {
        retrieve: vi.fn(async () => ({
          id: "acct_x",
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: true,
          requirements: { currently_due: ["x"] },
        })),
      },
    };

    await expect(
      assertConnectedAccountPayable({
        stripeAccountId: "acct_x",
        stripe: stripe as unknown as Stripe,
      }),
    ).rejects.toBeInstanceOf(StripeDomainError);
  });

  it("accepte un compte charges_enabled", async () => {
    const stripe = {
      accounts: {
        retrieve: vi.fn(async () => ({
          id: "acct_ok",
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
          capabilities: { card_payments: "active" },
          requirements: {},
        })),
      },
    };

    const account = await assertConnectedAccountPayable({
      stripeAccountId: "acct_ok",
      stripe: stripe as unknown as Stripe,
    });
    expect(account.charges_enabled).toBe(true);
  });
});

describe("éligibilité live par rail", () => {
  const stripeWithSepa = (status: "active" | "pending" | "inactive", restricted = false) =>
    ({
      accounts: {
        retrieve: vi.fn(async () => ({
          id: "acct_sepa",
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
          capabilities: { sepa_debit_payments: status },
          requirements: restricted ? { past_due: ["business_profile.url"] } : {},
        })),
      },
    }) as unknown as Stripe;

  it("accepte SEPA actif et refuse pending/inactive/restriction", async () => {
    await expect(
      assertConnectedAccountEligibleForPaymentRail({
        expectedAccountId: "acct_sepa",
        stripeAccountId: "acct_sepa",
        rail: "sepa_core",
        stripe: stripeWithSepa("active"),
      }),
    ).resolves.toMatchObject({ id: "acct_sepa" });

    for (const stripe of [
      stripeWithSepa("pending"),
      stripeWithSepa("inactive"),
      stripeWithSepa("active", true),
    ]) {
      await expect(
        assertConnectedAccountEligibleForPaymentRail({
          expectedAccountId: "acct_sepa",
          stripeAccountId: "acct_sepa",
          rail: "sepa_core",
          stripe,
        }),
      ).rejects.toBeInstanceOf(StripeDomainError);
    }
  });

  it("refuse un compte Connect différent du compte attendu", async () => {
    await expect(
      assertConnectedAccountEligibleForPaymentRail({
        expectedAccountId: "acct_other",
        stripeAccountId: "acct_sepa",
        rail: "sepa_core",
        stripe: stripeWithSepa("active"),
      }),
    ).rejects.toMatchObject({ code: "stripe_account_scope_mismatch" });
  });
});

describe("webhook process / dispatch", () => {
  it("vérifie une signature Stripe réelle sur le corps brut", async () => {
    const stripe = new Stripe("sk_test_signature_fixture");
    const payload = JSON.stringify({
      id: "evt_signed",
      object: "event",
      type: "invoice.paid",
      data: { object: {} },
    });
    const secret = "whsec_signature_fixture";
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
    const rpc = vi.fn(async (name: string) =>
      name === "claim_stripe_webhook_event"
        ? {
            data: { claimed: true, status: "processing", terminal: false, attempt: 1, lease_token: "11111111-1111-4111-8111-111111111111" },
            error: null,
          }
        : { data: { id: "evt_signed" }, error: null },
    );
    const result = await processStripeWebhookRequest({
      rawBody: payload,
      signatureHeader: signature,
      supabaseAdmin: { rpc } as never,
      stripe,
      webhookSecret: secret,
      sidianEnvironment: "local",
    });
    expect(result.httpStatus).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "mark_stripe_webhook_event_status",
      expect.objectContaining({ p_status: "ignored" }),
    );
  });

  it("marque un événement inconnu comme ignored sans transition métier", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_stripe_webhook_event") {
        return {
          data: { claimed: true, status: "processing", terminal: false, attempt: 1, lease_token: "11111111-1111-4111-8111-111111111111" },
          error: null,
        };
      }
      return { data: {}, error: null };
    });

    const stripe = {
      webhooks: {
        constructEvent: vi.fn(() => ({
          id: "evt_1",
          type: "invoice.paid",
          account: "acct_1",
          data: { object: {} },
        })),
      },
    };

    const result = await processStripeWebhookRequest({
      rawBody: "{}",
      signatureHeader: "t=1,v1=x",
      supabaseAdmin: { rpc } as never,
      stripe: stripe as unknown as Stripe,
      webhookSecret: "whsec_test",
      sidianEnvironment: "local",
    });

    expect(result.body.received).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "mark_stripe_webhook_event_status",
      expect.objectContaining({ p_status: "ignored" }),
    );
  });

  it("détecte un doublon sans retraiter", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_stripe_webhook_event") {
        return {
          data: { claimed: false, status: "processed", terminal: true },
          error: null,
        };
      }
      throw new Error(`unexpected rpc ${name}`);
    });

    const stripe = {
      webhooks: {
        constructEvent: vi.fn(() => ({
          id: "evt_dup",
          type: "account.updated",
          data: { object: { id: "acct_1" } },
        })),
      },
    };

    const result = await processStripeWebhookRequest({
      rawBody: "{}",
      signatureHeader: "t=1,v1=x",
      supabaseAdmin: { rpc } as never,
      stripe: stripe as unknown as Stripe,
      webhookSecret: "whsec_test",
      sidianEnvironment: "local",
    });

    expect(result.body.duplicate).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("persiste un échec transitoire et demande un retry Stripe", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_stripe_webhook_event") {
        return {
          data: { claimed: true, status: "processing", terminal: false, attempt: 2, lease_token: "11111111-1111-4111-8111-111111111111" },
          error: null,
        };
      }
      if (name === "mark_stripe_webhook_event_status") {
        return { data: { id: "evt_retry" }, error: null };
      }
      return { data: null, error: { message: "lookup unavailable" } };
    });
    const stripe = {
      webhooks: {
        constructEvent: vi.fn(() => ({
          id: "evt_retry",
          type: "account.updated",
          account: "acct_1",
          data: { object: { id: "acct_1", object: "account" } },
        })),
      },
    };

    const result = await processStripeWebhookRequest({
      rawBody: "{}",
      signatureHeader: "t=1,v1=x",
      supabaseAdmin: { rpc, from: vi.fn(() => ({ select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({
          data: null,
          error: { message: "db unavailable" },
        })) })),
      })) })) } as never,
      stripe: stripe as unknown as Stripe,
      webhookSecret: "whsec_test",
      sidianEnvironment: "local",
    });

    expect(result.httpStatus).toBe(503);
    expect(rpc).toHaveBeenCalledWith(
      "mark_stripe_webhook_event_status",
      expect.objectContaining({ p_status: "failed_retryable" }),
    );
  });

  it("ne répond pas 200 si la persistance du statut échoue", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_stripe_webhook_event") {
        return {
          data: { claimed: true, status: "processing", terminal: false, attempt: 1, lease_token: "11111111-1111-4111-8111-111111111111" },
          error: null,
        };
      }
      return { data: null, error: { message: "write failed" } };
    });
    const stripe = {
      webhooks: {
        constructEvent: vi.fn(() => ({
          id: "evt_status_fail",
          type: "invoice.paid",
          data: { object: {} },
        })),
      },
    };
    await expect(
      processStripeWebhookRequest({
        rawBody: "{}",
        signatureHeader: "t=1,v1=x",
        supabaseAdmin: { rpc } as never,
        stripe: stripe as unknown as Stripe,
        webhookSecret: "whsec_test",
        sidianEnvironment: "local",
      }),
    ).rejects.toMatchObject({ code: "stripe_webhook_status_persistence_failed" });
  });

  it("terminalise automatiquement la dernière tentative retryable", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_stripe_webhook_event") {
        return {
          data: {
            claimed: true,
            status: "processing",
            terminal: false,
            attempt: 8,
            lease_token: "11111111-1111-4111-8111-111111111111",
          },
          error: null,
        };
      }
      if (name === "mark_stripe_webhook_event_status") {
        return { data: { id: "evt_cap" }, error: null };
      }
      return { data: null, error: { message: "temporary database outage" } };
    });
    const stripe = {
      webhooks: {
        constructEvent: vi.fn(() => ({
          id: "evt_cap",
          type: "account.updated",
          account: "acct_1",
          data: { object: { id: "acct_1", object: "account" } },
        })),
      },
    };
    const result = await processStripeWebhookRequest({
      rawBody: "{}",
      signatureHeader: "t=1,v1=x",
      supabaseAdmin: {
        rpc,
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: null,
                error: { message: "db unavailable" },
              })),
            })),
          })),
        })),
      } as never,
      stripe: stripe as unknown as Stripe,
      webhookSecret: "whsec_test",
      sidianEnvironment: "local",
    });
    expect(result.httpStatus).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "mark_stripe_webhook_event_status",
      expect.objectContaining({ p_status: "failed_terminal" }),
    );
  });

  it("traite un token périmé comme lease_lost sans réécrire le statut", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_stripe_webhook_event") {
        return {
          data: {
            claimed: true,
            status: "processing",
            terminal: false,
            attempt: 1,
            lease_token: "11111111-1111-4111-8111-111111111111",
          },
          error: null,
        };
      }
      return { data: null, error: { message: "webhook_lease_lost" } };
    });
    const stripe = {
      webhooks: {
        constructEvent: vi.fn(() => ({
          id: "evt_lost",
          type: "invoice.paid",
          data: { object: {} },
        })),
      },
    };
    await expect(
      processStripeWebhookRequest({
        rawBody: "{}",
        signatureHeader: "t=1,v1=x",
        supabaseAdmin: { rpc } as never,
        stripe: stripe as unknown as Stripe,
        webhookSecret: "whsec_test",
        sidianEnvironment: "local",
      }),
    ).rejects.toMatchObject({ code: "webhook_lease_lost" });
  });

  it("ignore un événement MVP non encore implémenté", async () => {
    const result = await dispatchStripeWebhookEvent({
      event: {
        id: "evt_2",
        type: "checkout.session.completed",
        data: { object: {} },
      } as Stripe.Event,
      supabaseAdmin: {} as never,
      sidianEnvironment: "local",
      lease: {
        eventId: "evt_2",
        attempt: 1,
        leaseToken: "11111111-1111-4111-8111-111111111111",
      },
      renewLease: vi.fn(async () => undefined),
    });
    expect(result).toEqual({
      outcome: "ignored",
      reason: "deferred_to_sid_stripe_002",
    });
  });

  it("account.updated applique le dernier état live et renouvelle le lease", async () => {
    const renewLease = vi.fn(async () => undefined);
    const rpc = vi.fn(async (name: string) => {
      if (name === "apply_account_updated_projection") {
        return {
          data: { effect_registered: true, projection_applied: true },
          error: null,
        };
      }
      throw new Error(`unexpected rpc ${name}`);
    });
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: { id: "prest_1", stripe_account_id: "acct_1" },
              error: null,
            })),
          })),
        })),
      })),
      rpc,
    };
    const stripe = {
      accounts: {
        retrieve: vi.fn(async () => ({
          id: "acct_1",
          object: "account",
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
          capabilities: { sepa_debit_payments: "active" },
          requirements: {},
          metadata: {
            sidian_prestataire_id: "prest_1",
            sidian_environment: "local",
          },
        })),
      },
    };
    await expect(
      dispatchStripeWebhookEvent({
        event: {
          id: "evt_old_delivery",
          type: "account.updated",
          account: "acct_1",
          data: {
            object: {
              id: "acct_1",
              object: "account",
              charges_enabled: false,
            },
          },
        } as Stripe.Event,
        supabaseAdmin: supabase as never,
        stripe: stripe as unknown as Stripe,
        sidianEnvironment: "local",
        lease: {
          eventId: "evt_old_delivery",
          attempt: 2,
          leaseToken: "22222222-2222-4222-8222-222222222222",
        },
        renewLease,
      }),
    ).resolves.toMatchObject({ outcome: "processed" });
    expect(renewLease).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith(
      "apply_account_updated_projection",
      expect.objectContaining({
        p_stripe_event_id: "evt_old_delivery",
        p_processing_attempt: 2,
        p_lease_token: "22222222-2222-4222-8222-222222222222",
        p_charges_enabled: true,
      }),
    );
  });
});
