import { describe, expect, it, vi } from "vitest";

import { AUTOMATIC_EXECUTION_GUARD_VERSION } from "./constants";
import { evaluateAutomaticPaymentChecklist } from "./checklist";
import {
  buildOffSessionStripeIdempotencyKey,
  buildPaymentJobIdempotencyKey,
} from "./idempotency";
import {
  createMemoryPaymentAttemptRepository,
  createMemoryPaymentJobRepository,
} from "./memory-repository";
import { enqueueAutomaticPaymentCandidates } from "./scanner";
import { createPaymentRuntimeService } from "./service";
import { createPaymentRuntimeExecutors } from "./agent-executor";
import type { AutomaticPaymentChecklistInput } from "./types";
import { PaymentRuntimeError } from "./errors";

function baseChecklist(
  overrides: Partial<AutomaticPaymentChecklistInput> = {},
): AutomaticPaymentChecklistInput {
  return {
    paymentsEnabled: true,
    creance: {
      id: "creance-1",
      prestataireId: "prestataire-1",
      clientPayeurId: "client-1",
      etat: "OUVERTE",
      devise: "EUR",
      montant: 10_000,
      archivedAt: null,
      amountPaidCents: 0,
      remainingCents: 10_000,
    },
    dossier: { creanceId: "creance-1", etat: "ECHEANCE" },
    authorization: {
      id: "auth-1",
      prestataireId: "prestataire-1",
      clientPayeurId: "client-1",
      etat: "ACTIVE",
      isDefault: true,
      legacyIncomplete: false,
      type: "card_off_session",
      stripeAccountId: "acct_1",
      stripeCustomerId: "cus_1",
      stripePaymentMethodId: "pm_1",
      acceptedAt: "2026-07-01T00:00:00.000Z",
      authorizedAt: "2026-07-01T00:00:00.000Z",
      authorizationTextVersion: "sidian-future-payments-fr-v1",
      authorizationChannel: "stripe_checkout_setup",
    },
    activeAttempt: null,
    connect: {
      stripeAccountId: "acct_1",
      cardPaymentsActive: true,
      chargesEnabled: true,
      restricted: false,
    },
    requestedAmountCents: 10_000,
    requestedCurrency: "EUR",
    autoDebitCeilingCents: 50_000,
    productAutoDebitRulesReady: true,
    guardVersion: AUTOMATIC_EXECUTION_GUARD_VERSION,
    ...overrides,
  };
}

describe("payment runtime checklist", () => {
  it("passe quand toutes les portes sont satisfaites", () => {
    const result = evaluateAutomaticPaymentChecklist(baseChecklist());
    expect(result.ok).toBe(true);
  });

  it("fail-closed si plafond regle produit incomplet", () => {
    const result = evaluateAutomaticPaymentChecklist(
      baseChecklist({
        productAutoDebitRulesReady: false,
        autoDebitCeilingCents: null,
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("REGLE_AUTO_DEBIT_CEILING_UNDEFINED");
    }
  });

  it("refuse SEPA off-session", () => {
    const result = evaluateAutomaticPaymentChecklist(
      baseChecklist({
        authorization: {
          ...baseChecklist().authorization!,
          type: "sepa_core_mandate",
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("SEPA_PRENOTIFICATION_REQUIRED");
    }
  });

  it("refuse litige / escalade", () => {
    const result = evaluateAutomaticPaymentChecklist(
      baseChecklist({
        dossier: { creanceId: "creance-1", etat: "PAUSE_LITIGE" },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("FOLLOWUP_BLOCKED");
    }
  });

  it("refuse double tentative active", () => {
    const result = evaluateAutomaticPaymentChecklist(
      baseChecklist({
        activeAttempt: {
          id: "t-1",
          etat: "EN_TRAITEMENT",
          source: "lien_agent",
          stripePaymentIntentId: "pi_x",
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ACTIVE_ATTEMPT_EXISTS");
    }
  });
});

describe("payment runtime idempotency", () => {
  it("produit des clés Stripe stables", () => {
    const a = buildOffSessionStripeIdempotencyKey({
      creanceId: "c1",
      amountCents: 1000,
      currency: "EUR",
      authorizationId: "a1",
      attemptVersion: "v1",
    });
    const b = buildOffSessionStripeIdempotencyKey({
      creanceId: "c1",
      amountCents: 1000,
      currency: "EUR",
      authorizationId: "a1",
      attemptVersion: "v1",
    });
    expect(a).toBe(b);
    expect(a.startsWith("sidian_offsession_pi_")).toBe(true);
  });

  it("différencie scanner et agent_tool", () => {
    const scanner = buildPaymentJobIdempotencyKey({
      creanceId: "c1",
      amountCents: 1000,
      currency: "EUR",
      attemptVersion: "v1",
      source: "scanner",
    });
    const agent = buildPaymentJobIdempotencyKey({
      creanceId: "c1",
      amountCents: 1000,
      currency: "EUR",
      attemptVersion: "v1",
      source: "agent_tool",
    });
    expect(scanner).not.toBe(agent);
  });
});

describe("payment runtime service", () => {
  it("scanner enqueue sans appeler Stripe", async () => {
    const createPi = vi.fn();
    const jobs = createMemoryPaymentJobRepository();
    const attempts = createMemoryPaymentAttemptRepository({
      checklist: baseChecklist({ productAutoDebitRulesReady: false }),
    });
    const runtime = createPaymentRuntimeService({
      jobs,
      attempts,
      paymentsEnabled: true,
      createPaymentIntent: createPi,
    });

    const scan = await enqueueAutomaticPaymentCandidates({
      runtime,
      candidates: [
        {
          prestataireId: "prestataire-1",
          creanceId: "creance-1",
          remainingCents: 10_000,
          attemptVersion: "2026-07-26",
        },
      ],
    });

    expect(scan.enqueued).toHaveLength(1);
    expect(createPi).not.toHaveBeenCalled();
  });

  it("refuse un appel depuis un contexte webhook inbound", () => {
    const runtime = createPaymentRuntimeService({
      jobs: createMemoryPaymentJobRepository(),
      attempts: createMemoryPaymentAttemptRepository({
        checklist: baseChecklist(),
      }),
      paymentsEnabled: true,
    });
    expect(() =>
      runtime.assertNotInboundWebhook({ caller: "stripe_webhook" }),
    ).toThrow(PaymentRuntimeError);
  });

  it("draine en fail-closed si regle incomplete (aucun PI)", async () => {
    const createPi = vi.fn();
    const jobs = createMemoryPaymentJobRepository();
    const attempts = createMemoryPaymentAttemptRepository({
      checklist: baseChecklist({
        productAutoDebitRulesReady: false,
        autoDebitCeilingCents: null,
      }),
    });
    const runtime = createPaymentRuntimeService({
      jobs,
      attempts,
      paymentsEnabled: true,
      createPaymentIntent: createPi,
    });

    const job = await runtime.enqueue({
      prestataireId: "prestataire-1",
      creanceId: "creance-1",
      amountCents: 10_000,
      currency: "EUR",
      source: "scanner",
      idempotencyKey: "job-key-1",
    });
    const drain = await runtime.drain({ jobId: job.id });
    expect(drain?.status).toBe("failure");
    if (drain?.status === "failure") {
      expect(drain.code).toBe("REGLE_AUTO_DEBIT_CEILING_UNDEFINED");
    }
    expect(createPi).not.toHaveBeenCalled();
  });

  it("crée un PI et reste pending (webhook SoT) quand checklist ok", async () => {
    const createPi = vi.fn(async () => ({
      kind: "created" as const,
      paymentIntentId: "pi_test_1",
      providerStatus: "succeeded",
      requiresAction: false,
    }));
    const jobs = createMemoryPaymentJobRepository();
    const attempts = createMemoryPaymentAttemptRepository({
      checklist: baseChecklist(),
    });
    const runtime = createPaymentRuntimeService({
      jobs,
      attempts,
      paymentsEnabled: true,
      createPaymentIntent: createPi,
    });

    const job = await runtime.enqueue({
      prestataireId: "prestataire-1",
      creanceId: "creance-1",
      amountCents: 10_000,
      currency: "EUR",
      source: "agent_tool",
      idempotencyKey: "job-key-2",
    });
    const drain = await runtime.drain({ jobId: job.id });

    expect(createPi).toHaveBeenCalledOnce();
    expect(drain?.status).toBe("pending");
    if (drain?.status === "pending") {
      expect(drain.external_reference).toBe("pi_test_1");
      expect(drain.provider_status).toBe("succeeded");
    }
    // Même si Stripe dit succeeded, on ne pose pas success outil / RÉUSSIE locale.
    const stored = [...attempts.tentatives.values()][0];
    expect(stored.etat).toBe("CREEE");
    expect(stored.stripePaymentIntentId).toBe("pi_test_1");
  });

  it("classifie unknown sans rejeu agressif", async () => {
    const createPi = vi.fn(async () => ({
      kind: "unknown" as const,
      code: "stripe_StripeConnectionError",
    }));
    const jobs = createMemoryPaymentJobRepository();
    const attempts = createMemoryPaymentAttemptRepository({
      checklist: baseChecklist(),
    });
    const runtime = createPaymentRuntimeService({
      jobs,
      attempts,
      paymentsEnabled: true,
      createPaymentIntent: createPi,
    });

    const job = await runtime.enqueue({
      prestataireId: "prestataire-1",
      creanceId: "creance-1",
      amountCents: 10_000,
      currency: "EUR",
      source: "scanner",
      idempotencyKey: "job-key-3",
    });
    const drain = await runtime.drain({ jobId: job.id });
    expect(drain?.status).toBe("unknown");
  });

  it("double exécution : second drain ne recrée pas de PI", async () => {
    const createPi = vi.fn(async () => ({
      kind: "created" as const,
      paymentIntentId: "pi_once",
      providerStatus: "processing",
      requiresAction: false,
    }));
    const jobs = createMemoryPaymentJobRepository();
    const attempts = createMemoryPaymentAttemptRepository({
      checklist: baseChecklist(),
    });
    const runtime = createPaymentRuntimeService({
      jobs,
      attempts,
      paymentsEnabled: true,
      createPaymentIntent: createPi,
    });

    const job = await runtime.enqueue({
      prestataireId: "prestataire-1",
      creanceId: "creance-1",
      amountCents: 10_000,
      currency: "EUR",
      source: "scanner",
      idempotencyKey: "job-key-double",
    });
    const first = await runtime.drain({ jobId: job.id });
    const second = await runtime.drain({ jobId: job.id });
    expect(first?.status).toBe("pending");
    expect(second?.status).toBe("pending");
    expect(createPi).toHaveBeenCalledOnce();
  });

  it("annulation créance avant exécution → fail-closed", async () => {
    const createPi = vi.fn();
    const runtime = createPaymentRuntimeService({
      jobs: createMemoryPaymentJobRepository(),
      attempts: createMemoryPaymentAttemptRepository({
        checklist: baseChecklist({
          creance: {
            ...baseChecklist().creance,
            etat: "ANNULEE",
            remainingCents: 10_000,
          },
        }),
      }),
      paymentsEnabled: true,
      createPaymentIntent: createPi,
    });
    const job = await runtime.enqueue({
      prestataireId: "prestataire-1",
      creanceId: "creance-1",
      amountCents: 10_000,
      currency: "EUR",
      source: "scanner",
      idempotencyKey: "job-key-cancel",
    });
    const drain = await runtime.drain({ jobId: job.id });
    expect(drain?.status).toBe("failure");
    if (drain?.status === "failure") {
      expect(drain.code).toBe("INVALID_CREANCE_STATE");
    }
    expect(createPi).not.toHaveBeenCalled();
  });

  it("paiement reçu (REGLEE) avant exécution → fail-closed", async () => {
    const createPi = vi.fn();
    const runtime = createPaymentRuntimeService({
      jobs: createMemoryPaymentJobRepository(),
      attempts: createMemoryPaymentAttemptRepository({
        checklist: baseChecklist({
          creance: {
            ...baseChecklist().creance,
            etat: "REGLEE",
            remainingCents: 0,
            amountPaidCents: 10_000,
          },
          requestedAmountCents: 10_000,
        }),
      }),
      paymentsEnabled: true,
      createPaymentIntent: createPi,
    });
    const job = await runtime.enqueue({
      prestataireId: "prestataire-1",
      creanceId: "creance-1",
      amountCents: 10_000,
      currency: "EUR",
      source: "scanner",
      idempotencyKey: "job-key-paid",
    });
    const drain = await runtime.drain({ jobId: job.id });
    expect(drain?.status).toBe("failure");
    expect(createPi).not.toHaveBeenCalled();
  });

  it("paiement partiel : montant ≠ solde restant refusé", () => {
    const result = evaluateAutomaticPaymentChecklist(
      baseChecklist({
        creance: {
          ...baseChecklist().creance,
          etat: "PARTIELLEMENT_REGLEE",
          remainingCents: 4_000,
          amountPaidCents: 6_000,
        },
        requestedAmountCents: 10_000,
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("AMOUNT_EXCEEDS_REMAINING");
    }
  });

  it("autorisation absente / expirée → AUTHORIZATION_INELIGIBLE", () => {
    expect(
      evaluateAutomaticPaymentChecklist(
        baseChecklist({ authorization: null }),
      ).ok,
    ).toBe(false);
    const expired = evaluateAutomaticPaymentChecklist(
      baseChecklist({
        authorization: {
          ...baseChecklist().authorization!,
          etat: "REVOKED",
        },
      }),
    );
    expect(expired.ok).toBe(false);
    if (!expired.ok) {
      expect(expired.code).toBe("AUTHORIZATION_INELIGIBLE");
    }
  });

  it("plafond dépassé → refuse le débit", () => {
    const result = evaluateAutomaticPaymentChecklist(
      baseChecklist({
        autoDebitCeilingCents: 5_000,
        requestedAmountCents: 10_000,
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("REGLE_AUTO_DEBIT_CEILING_UNDEFINED");
    }
  });

  it("erreur Stripe temporaire → failed_retryable sans succès local", async () => {
    const createPi = vi.fn(async () => ({
      kind: "temporary_failure" as const,
      code: "rate_limited",
      retryable: true as const,
    }));
    const jobs = createMemoryPaymentJobRepository();
    const attempts = createMemoryPaymentAttemptRepository({
      checklist: baseChecklist(),
    });
    const runtime = createPaymentRuntimeService({
      jobs,
      attempts,
      paymentsEnabled: true,
      createPaymentIntent: createPi,
    });
    const job = await runtime.enqueue({
      prestataireId: "prestataire-1",
      creanceId: "creance-1",
      amountCents: 10_000,
      currency: "EUR",
      source: "scanner",
      idempotencyKey: "job-key-tmp",
    });
    const drain = await runtime.drain({ jobId: job.id });
    expect(drain?.status).toBe("failure");
    if (drain?.status === "failure") {
      expect(drain.code).toBe("PROVIDER_TEMPORARY_FAILURE");
    }
  });

  it("erreur Stripe permanente → failed_terminal", async () => {
    const createPi = vi.fn(async () => ({
      kind: "permanent_failure" as const,
      code: "card_declined",
      retryable: false as const,
    }));
    const jobs = createMemoryPaymentJobRepository();
    const attempts = createMemoryPaymentAttemptRepository({
      checklist: baseChecklist(),
    });
    const runtime = createPaymentRuntimeService({
      jobs,
      attempts,
      paymentsEnabled: true,
      createPaymentIntent: createPi,
    });
    const job = await runtime.enqueue({
      prestataireId: "prestataire-1",
      creanceId: "creance-1",
      amountCents: 10_000,
      currency: "EUR",
      source: "scanner",
      idempotencyKey: "job-key-perm",
    });
    const drain = await runtime.drain({ jobId: job.id });
    expect(drain?.status).toBe("failure");
    if (drain?.status === "failure") {
      expect(drain.code).toBe("PROVIDER_PERMANENT_FAILURE");
    }
  });
});

describe("payment.create_attempt agent executor", () => {
  it("résout payment.create_attempt@1.0.0 et fail-closed produit", async () => {
    const jobs = createMemoryPaymentJobRepository();
    const attempts = createMemoryPaymentAttemptRepository({
      checklist: baseChecklist({
        productAutoDebitRulesReady: false,
        autoDebitCeilingCents: null,
      }),
    });
    const runtime = createPaymentRuntimeService({
      jobs,
      attempts,
      paymentsEnabled: true,
      createPaymentIntent: vi.fn(),
    });
    const resolve = createPaymentRuntimeExecutors(runtime);
    const executor = resolve("payment.create_attempt", "1.0.0");
    expect(executor).toBeDefined();

    const output = await executor!.execute({
      arguments: {
        invoice_id: "creance-1",
        amount_cents: 10_000,
        currency: "EUR",
      },
      actor: { actor_id: "user-1", actor_type: "human" },
      tenant: { tenant_id: "prestataire-1" },
      correlation_id: "corr-1",
    });

    expect(output).toMatchObject({
      status: "failure",
      provider_status: "REGLE_AUTO_DEBIT_CEILING_UNDEFINED",
    });
  });

  it("ignore les autres tools", () => {
    const runtime = createPaymentRuntimeService({
      jobs: createMemoryPaymentJobRepository(),
      attempts: createMemoryPaymentAttemptRepository({
        checklist: baseChecklist(),
      }),
      paymentsEnabled: true,
    });
    const resolve = createPaymentRuntimeExecutors(runtime);
    expect(resolve("protection.draft.get", "1.0.0")).toBeUndefined();
    expect(resolve("payment.create_attempt", "0.9.0")).toBeUndefined();
  });
});
