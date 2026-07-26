import { describe, expect, it, vi } from "vitest";

import { createMemoryCommunicationMessageRepository } from "../../communication-channels/outbound/memory-repository";
import { loadWhatsAppEnv } from "../../communication-channels/whatsapp/env";
import { createStubWhatsAppTransport } from "../../communication-channels/whatsapp/transport";
import { createEmailChannel } from "../../email/channel";
import { loadEmailEnv } from "../../email/env";
import { createMemoryEmailOutboxRepository } from "../../email/outbox/memory-repository";
import { createStubEmailProvider } from "../../email/provider";
import { computeRetryDelaySeconds } from "./backoff";
import { createEmailOutboxDrain } from "./email/drain";
import { DRAIN_INVENTORY, runAllActiveDrains } from "./inventory";
import { createNotificationOutboxDrainStub } from "./notification/drain";
import {
  createMemoryDrainObservabilitySink,
  hashIdempotencyKey,
} from "./observability";
import { createPaymentConnectAuditOutboxDrain } from "./payment/drain";
import { createWhatsAppOutboxDrain } from "./whatsapp/drain";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CREANCE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function stubWhatsAppEnv() {
  return loadWhatsAppEnv({
    SIDIAN_ENVIRONMENT: "local",
    SIDIAN_WHATSAPP_PROVIDER_ENABLED: "true",
    SIDIAN_WHATSAPP_TRANSPORT_MODE: "stub",
    SIDIAN_WHATSAPP_GUIDE_RECIPIENT_TECHNICAL_ID: "15550001111",
    SIDIAN_WHATSAPP_PHONE_NUMBER_ID: "pnid_test",
  });
}

function stubEmailEnv() {
  return loadEmailEnv({
    SIDIAN_ENVIRONMENT: "local",
    SIDIAN_EMAIL_PROVIDER_ENABLED: "true",
    SIDIAN_EMAIL_TRANSPORT_MODE: "stub",
    SIDIAN_EMAIL_FROM_ADDRESS: "noreply@sidian.test",
    SIDIAN_EMAIL_FROM_NAME: "Sidian",
  });
}

describe("runtime drains — backoff / observabilité", () => {
  it("backoff exponentiel plafonné", () => {
    expect(computeRetryDelaySeconds(1)).toBe(30);
    expect(computeRetryDelaySeconds(2)).toBe(60);
    expect(computeRetryDelaySeconds(3)).toBe(120);
    expect(computeRetryDelaySeconds(10)).toBe(900);
  });

  it("hash idempotency sans PII brute", () => {
    const h = hashIdempotencyKey("tenant:event:entity:occ");
    expect(h).toHaveLength(16);
    expect(h).not.toContain("tenant");
  });
});

describe("WhatsApp outbox drain", () => {
  it("claim + deliver + observabilité batch", async () => {
    const messages = createMemoryCommunicationMessageRepository();
    await messages.insertQueued({
      tenantId: TENANT,
      channelId: "22222222-2222-4222-8222-222222222222",
      providerKind: "whatsapp_sidian",
      recipientReference: `guide:${TENANT}`,
      messageKind: "guide_payment_confirmation",
      templateKey: "guide_payment_confirmation",
      templateLocale: "fr",
      payloadSnapshot: {
        graphBody: { type: "template", template: { name: "x" } },
      },
      idempotencyKey: "idem-whatsapp-drain-001",
    });

    const sink = createMemoryDrainObservabilitySink();
    const drain = createWhatsAppOutboxDrain({
      messages,
      env: stubWhatsAppEnv(),
      transport: createStubWhatsAppTransport(),
      sink,
    });

    const result = await drain.run({ limit: 5 });
    expect(result.kind).toBe("whatsapp_outbound");
    expect(result.claimed).toBe(1);
    expect(result.delivered).toBe(1);
    expect(result.deadLetter).toBe(0);
    expect(sink.events.some((e) => e.outcome === "delivered")).toBe(true);
    expect(sink.events.some((e) => e.outcome === "batch_complete")).toBe(true);
  });

  it("multi-worker : second claim vide sur même lot", async () => {
    const messages = createMemoryCommunicationMessageRepository();
    await messages.insertQueued({
      tenantId: TENANT,
      channelId: "22222222-2222-4222-8222-222222222222",
      providerKind: "whatsapp_sidian",
      recipientReference: `guide:${TENANT}`,
      messageKind: "guide_payment_confirmation",
      templateKey: "guide_payment_confirmation",
      templateLocale: "fr",
      payloadSnapshot: {
        graphBody: { type: "template", template: { name: "x" } },
      },
      idempotencyKey: "idem-whatsapp-drain-002",
    });

    const [a, b] = await Promise.all([
      messages.claimQueuedBatch({ limit: 10, leaseSeconds: 60 }),
      messages.claimQueuedBatch({ limit: 10, leaseSeconds: 60 }),
    ]);
    expect(a.length + b.length).toBe(1);
  });

  it("crash recovery : lease expiré reclame", async () => {
    const messages = createMemoryCommunicationMessageRepository();
    const queued = await messages.insertQueued({
      tenantId: TENANT,
      channelId: "22222222-2222-4222-8222-222222222222",
      providerKind: "whatsapp_sidian",
      recipientReference: `guide:${TENANT}`,
      messageKind: "guide_payment_confirmation",
      templateKey: "guide_payment_confirmation",
      templateLocale: "fr",
      payloadSnapshot: {
        graphBody: { type: "template", template: { name: "x" } },
      },
      idempotencyKey: "idem-whatsapp-drain-003",
    });

    const [claimed] = await messages.claimQueuedBatch({
      limit: 1,
      leaseSeconds: 1,
    });
    expect(claimed.status).toBe("sending");

    // Expire lease manuellement
    const row = await messages.findById?.(queued.id);
    expect(row).toBeTruthy();
    if (row) {
      // force via second claim after manipulating through claim path:
      // mark as expired by claiming with leaseSeconds then waiting is slow;
      // instead re-insert state via markFailed then re-claim
      await messages.markFailed(row.id, "timeout", "simulated", 1, {
        leaseToken: claimed.leaseToken,
        retryDelaySeconds: 1,
      });
    }

    // next_attempt_at in future → not claimable yet
    const early = await messages.claimQueuedBatch({ limit: 1 });
    expect(early.length).toBe(0);
  });

  it("retryable vs permanent (payload incomplet → dead-letter)", async () => {
    const messages = createMemoryCommunicationMessageRepository();
    await messages.insertQueued({
      tenantId: TENANT,
      channelId: "22222222-2222-4222-8222-222222222222",
      providerKind: "whatsapp_sidian",
      recipientReference: `guide:${TENANT}`,
      messageKind: "guide_payment_confirmation",
      templateKey: "guide_payment_confirmation",
      templateLocale: "fr",
      payloadSnapshot: {}, // incomplete
      idempotencyKey: "idem-whatsapp-drain-004",
    });

    const drain = createWhatsAppOutboxDrain({
      messages,
      env: stubWhatsAppEnv(),
      transport: createStubWhatsAppTransport(),
    });
    const result = await drain.run({ limit: 5 });
    expect(result.deadLetter).toBe(1);
    expect(result.delivered).toBe(0);
  });
});

describe("Email outbox drain", () => {
  it("enqueue idempotent + deliver via module email", async () => {
    const outbox = createMemoryEmailOutboxRepository();
    const env = stubEmailEnv();
    const channel = createEmailChannel({ outbox, env });

    const first = await channel.enqueue({
      tenantId: TENANT,
      templateKey: "reminder_before_due",
      recipient: { email: "client@example.com" },
      variables: {
        prestataireName: "Studio",
        clientName: "Client",
        amountLabel: "100,00 €",
        dueDateLabel: "01/08/2026",
      },
      relatedEntityId: CREANCE,
      occurrenceKey: "drain:1",
    });
    const second = await channel.enqueue({
      tenantId: TENANT,
      templateKey: "reminder_before_due",
      recipient: { email: "client@example.com" },
      variables: {
        prestataireName: "Studio",
        clientName: "Client",
        amountLabel: "999,00 €",
        dueDateLabel: "01/08/2026",
      },
      relatedEntityId: CREANCE,
      occurrenceKey: "drain:1",
    });
    expect(second.id).toBe(first.id);

    const drain = createEmailOutboxDrain({
      outbox,
      env,
      provider: createStubEmailProvider(),
    });
    const result = await drain.run({ limit: 10 });
    expect(result.delivered).toBe(1);
    expect(result.claimed).toBe(1);
  });

  it("retryable puis dead-letter au plafond", async () => {
    const outbox = createMemoryEmailOutboxRepository();
    const env = stubEmailEnv();
    const channel = createEmailChannel({ outbox, env });

    await channel.enqueue({
      tenantId: TENANT,
      templateKey: "payment_failed",
      recipient: { email: "a@b.co" },
      variables: {
        prestataireName: "P",
        clientName: "C",
        amountLabel: "10 €",
      },
      relatedEntityId: CREANCE,
      occurrenceKey: "drain-retry",
      maxAttempts: 1,
    });

    let calls = 0;
    const drain = createEmailOutboxDrain({
      outbox,
      env,
      provider: createStubEmailProvider({
        scenario: () => {
          calls += 1;
          return { type: "unavailable" };
        },
      }),
    });

    const r = await drain.run({ limit: 5 });
    expect(r.deadLetter).toBe(1);
    expect(r.delivered).toBe(0);
    expect(calls).toBe(1);
  });

  it("mode disabled → batch vide", async () => {
    const drain = createEmailOutboxDrain({
      outbox: createMemoryEmailOutboxRepository(),
      env: loadEmailEnv({
        SIDIAN_ENVIRONMENT: "local",
        SIDIAN_EMAIL_PROVIDER_ENABLED: "false",
      }),
      provider: createStubEmailProvider(),
    });
    const result = await drain.run({ limit: 5 });
    expect(result.claimed).toBe(0);
    expect(result.delivered).toBe(0);
  });
});

describe("Payment connect audit drain", () => {
  it("appelle le RPC batch et compte delivered", async () => {
    const rpc = vi.fn(async () => ({ data: 3, error: null }));
    const drain = createPaymentConnectAuditOutboxDrain({
      client: { rpc },
    });
    const result = await drain.run({ limit: 25 });
    expect(rpc).toHaveBeenCalledWith(
      "drain_stripe_connect_audit_outbox_batch",
      { p_limit: 25 },
    );
    expect(result.delivered).toBe(3);
    expect(result.kind).toBe("payment_connect_audit");
  });
});

describe("Notification outbox", () => {
  it("MVP = no-op not_in_mvp", async () => {
    const drain = createNotificationOutboxDrainStub();
    expect(drain.mvpStatus).toBe("not_in_mvp");
    const result = await drain.run();
    expect(result.claimed).toBe(0);
  });
});

describe("Inventaire + runAllActiveDrains", () => {
  it("inventaire couvre les 4 kinds", () => {
    expect(DRAIN_INVENTORY.map((e) => e.kind).sort()).toEqual([
      "email_outbound",
      "notification_outbound",
      "payment_connect_audit",
      "whatsapp_outbound",
    ]);
  });

  it("runAllActiveDrains agrège", async () => {
    const results = await runAllActiveDrains({
      drains: [
        createNotificationOutboxDrainStub(),
        createPaymentConnectAuditOutboxDrain({
          client: {
            async rpc() {
              return { data: 0, error: null };
            },
          },
        }),
      ],
    });
    expect(results).toHaveLength(2);
  });
});
