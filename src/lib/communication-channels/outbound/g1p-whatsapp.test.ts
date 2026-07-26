import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createMemoryCommunicationChannelRepository } from "../test-fixtures/memory-repository";
import type { CommunicationChannel } from "../types";
import {
  buildOutboundIdempotencyKey,
  guideRecipientReference,
} from "./idempotency";
import { createMemoryCommunicationMessageRepository } from "./memory-repository";
import { createSupabaseCommunicationMessageRepository } from "./supabase-message-repository";
import { processOutboundMessage } from "./processor";
import { createOutboundMessageService } from "./service";
import { canTransitionMessageStatus } from "./types";
import { loadWhatsAppEnv } from "../whatsapp/env";
import {
  buildGraphTemplateBody,
  resolveCommunicationTemplate,
} from "../whatsapp/templates/registry";
import {
  createGraphWhatsAppTransport,
  createStubWhatsAppTransport,
  WhatsAppTransportError,
} from "../whatsapp/transport";
import { parseWhatsAppStatusEvents } from "../whatsapp/webhook/parse";
import {
  createMemoryWebhookEventRepository,
  processWhatsAppStatusWebhook,
} from "../whatsapp/webhook/process";
import {
  verifyWhatsAppSignature,
  verifyWhatsAppWebhookChallenge,
} from "../whatsapp/webhook/verify";
import { assertNoPhoneInBusinessInput } from "../service";
import { CommunicationChannelError } from "../errors";

const TENANT = "11111111-1111-4111-8111-111111111111";
const PROTECTION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function channel(): CommunicationChannel {
  const now = "2026-07-26T12:00:00.000Z";
  return {
    id: "ch_wa",
    prestataireId: TENANT,
    providerKind: "whatsapp_sidian",
    status: "active",
    displayName: "WhatsApp Sidian",
    providerRef: "sidian_platform",
    isDefault: true,
    publicMetadata: {},
    activatedAt: now,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function stubEnv(overrides: Record<string, string> = {}) {
  return loadWhatsAppEnv({
    SIDIAN_ENVIRONMENT: "local",
    SIDIAN_WHATSAPP_PROVIDER_ENABLED: "true",
    SIDIAN_WHATSAPP_TRANSPORT_MODE: "stub",
    SIDIAN_WHATSAPP_GUIDE_RECIPIENT_TECHNICAL_ID: "15550001111",
    SIDIAN_WHATSAPP_PHONE_NUMBER_ID: "pnid_test",
    ...overrides,
  });
}

describe("G1-P WhatsApp transport", () => {
  it("refuse les numéros dans l’API métier", () => {
    expect(() =>
      assertNoPhoneInBusinessInput({ phoneNumber: "+33600000000" }),
    ).toThrow(CommunicationChannelError);
  });

  it("exige un TRANSPORT_MODE explicite si le provider est activé", () => {
    expect(() =>
      loadWhatsAppEnv({
        SIDIAN_ENVIRONMENT: "local",
        SIDIAN_WHATSAPP_PROVIDER_ENABLED: "true",
      }),
    ).toThrow(/TRANSPORT_MODE/);
  });

  it("refuse stub hors environnement local", () => {
    expect(() =>
      loadWhatsAppEnv({
        SIDIAN_ENVIRONMENT: "production",
        SIDIAN_WHATSAPP_PROVIDER_ENABLED: "true",
        SIDIAN_WHATSAPP_TRANSPORT_MODE: "stub",
      }),
    ).toThrow(/stub interdit/);
  });

  it("échoue si la config live est incomplète", () => {
    expect(() =>
      loadWhatsAppEnv({
        SIDIAN_WHATSAPP_PROVIDER_ENABLED: "true",
        SIDIAN_WHATSAPP_TRANSPORT_MODE: "live",
      }),
    ).toThrow(/Configuration WhatsApp live incomplète/);
  });

  it("mappe le template guide_payment_confirmation", () => {
    const resolved = resolveCommunicationTemplate({
      templateKey: "guide_payment_confirmation",
      locale: "fr",
      variables: { amountLabel: "2 400 €", clientName: "Dupont Conseil" },
    });
    expect(resolved.bodyParameters).toEqual(["2 400 €", "Dupont Conseil"]);
    expect(resolved.buttonTitles).toHaveLength(4);
    const body = buildGraphTemplateBody({
      toTechnicalId: "15550001111",
      template: resolved,
    });
    expect(body.type).toBe("interactive");
  });

  it("échoue si une variable obligatoire est absente", () => {
    expect(() =>
      resolveCommunicationTemplate({
        templateKey: "guide_payment_confirmation",
        locale: "fr",
        variables: { amountLabel: "2 400 €", clientName: "" },
      }),
    ).toThrow(/template_variable_empty/);
  });

  it("enqueue + envoi nominal stub avec idempotence", async () => {
    const channels = createMemoryCommunicationChannelRepository([channel()]);
    const messages = createMemoryCommunicationMessageRepository();
    const outbound = createOutboundMessageService({
      channels,
      messages,
      guideRecipientTechnicalId: "15550001111",
    });

    const first = await outbound.queueGuidePaymentConfirmation({
      tenantId: TENANT,
      protectionId: PROTECTION,
      occurrenceKey: "2026-07-26",
      amountDueCents: 240_000,
      variables: { amountLabel: "2 400 €", clientName: "Dupont Conseil" },
    });
    const second = await outbound.queueGuidePaymentConfirmation({
      tenantId: TENANT,
      protectionId: PROTECTION,
      occurrenceKey: "2026-07-26",
      amountDueCents: 240_000,
      variables: { amountLabel: "2 400 €", clientName: "Dupont Conseil" },
    });

    expect(second.id).toBe(first.id);
    expect(first.status).toBe("queued");
    expect(JSON.stringify(first)).not.toMatch(/\+33/);

    const result = await processOutboundMessage({
      messageId: first.id,
      messages,
      env: stubEnv(),
      transport: createStubWhatsAppTransport({
        scenario: { type: "success", providerMessageId: "wamid.ABC" },
      }),
    });

    expect(result.outcome).toBe("accepted");
    if (result.outcome === "accepted") {
      expect(result.message.providerMessageId).toBe("wamid.ABC");
      expect(result.message.status).toBe("accepted");
    }
  });

  it("classifie timeout comme retryable sans second message logique", async () => {
    const channels = createMemoryCommunicationChannelRepository([channel()]);
    const messages = createMemoryCommunicationMessageRepository();
    const outbound = createOutboundMessageService({
      channels,
      messages,
      guideRecipientTechnicalId: "15550001111",
    });
    const queued = await outbound.queueGuidePaymentConfirmation({
      tenantId: TENANT,
      protectionId: PROTECTION,
      occurrenceKey: "timeout-1",
      amountDueCents: 240_000,
      variables: { amountLabel: "100 €", clientName: "Client" },
    });

    const result = await processOutboundMessage({
      messageId: queued.id,
      messages,
      env: stubEnv(),
      transport: createStubWhatsAppTransport({ scenario: { type: "timeout" } }),
    });

    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") {
      expect(result.retryable).toBe(true);
      expect(result.message.status).toBe("queued");
      expect(result.message.attemptCount).toBe(1);
    }

    const again = await messages.findByIdempotencyKey(
      TENANT,
      queued.idempotencyKey,
    );
    expect(again?.id).toBe(queued.id);
  });

  it("n’effectue pas de retry sur erreur d’auth", async () => {
    const channels = createMemoryCommunicationChannelRepository([channel()]);
    const messages = createMemoryCommunicationMessageRepository();
    const outbound = createOutboundMessageService({
      channels,
      messages,
      guideRecipientTechnicalId: "15550001111",
    });
    const queued = await outbound.queueGuidePaymentConfirmation({
      tenantId: TENANT,
      protectionId: PROTECTION,
      occurrenceKey: "auth-1",
      amountDueCents: 240_000,
      variables: { amountLabel: "100 €", clientName: "Client" },
    });

    const result = await processOutboundMessage({
      messageId: queued.id,
      messages,
      env: stubEnv(),
      transport: createStubWhatsAppTransport({ scenario: { type: "auth" } }),
    });

    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") {
      expect(result.retryable).toBe(false);
      expect(result.message.status).toBe("failed");
    }
  });

  it("gère timeout HTTP du client Graph", async () => {
    const transport = createGraphWhatsAppTransport({
      accessToken: "token",
      graphApiVersion: "v21.0",
      fetchImpl: async () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      },
    });

    await expect(
      transport.send({
        phoneNumberId: "pnid",
        toTechnicalId: "1",
        graphBody: {},
        timeoutMs: 10,
      }),
    ).rejects.toMatchObject({
      category: "retryable",
      message: "whatsapp_timeout",
    } satisfies Partial<WhatsAppTransportError>);
  });

  it("vérifie challenge et signature webhook", () => {
    const challenge = verifyWhatsAppWebhookChallenge({
      mode: "subscribe",
      verifyToken: "verify_token_value",
      challenge: "12345",
      expectedToken: "verify_token_value",
    });
    expect(challenge).toEqual({ ok: true, challenge: "12345" });

    const body = Buffer.from('{"object":"whatsapp_business_account"}');
    const secret = "app_secret_value_16";
    const digest = createHmac("sha256", secret).update(body).digest("hex");
    expect(
      verifyWhatsAppSignature({
        rawBody: body,
        signatureHeader: `sha256=${digest}`,
        appSecret: secret,
      }),
    ).toBe(true);
    expect(
      verifyWhatsAppSignature({
        rawBody: body,
        signatureHeader: "sha256=deadbeef",
        appSecret: secret,
      }),
    ).toBe(false);
  });

  it("applique webhook accepted→delivered→read et refuse régression", async () => {
    const messages = createMemoryCommunicationMessageRepository();
    const events = createMemoryWebhookEventRepository();
    const channels = createMemoryCommunicationChannelRepository([channel()]);
    const outbound = createOutboundMessageService({
      channels,
      messages,
      guideRecipientTechnicalId: "15550001111",
    });
    const queued = await outbound.queueGuidePaymentConfirmation({
      tenantId: TENANT,
      protectionId: PROTECTION,
      occurrenceKey: "wh-1",
      amountDueCents: 240_000,
      variables: { amountLabel: "2 400 €", clientName: "Dupont Conseil" },
    });
    await processOutboundMessage({
      messageId: queued.id,
      messages,
      env: stubEnv(),
      transport: createStubWhatsAppTransport({
        scenario: { type: "success", providerMessageId: "wamid.XYZ" },
      }),
    });

    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: "wamid.XYZ", status: "delivered", timestamp: "1700000000" },
                  { id: "wamid.XYZ", status: "read", timestamp: "1700000001" },
                ],
              },
            },
          ],
        },
      ],
    };

    const first = await processWhatsAppStatusWebhook({
      payload,
      messages,
      events,
    });
    expect(first.applied).toBe(2);

    const dup = await processWhatsAppStatusWebhook({
      payload,
      messages,
      events,
    });
    expect(dup.duplicates).toBe(2);

    const row = await messages.findByProviderMessageId(
      "whatsapp_sidian",
      "wamid.XYZ",
    );
    expect(row?.status).toBe("read");
    expect(canTransitionMessageStatus("read", "delivered")).toBe(false);
  });

  it("ignore webhook pour message inconnu", async () => {
    const result = await processWhatsAppStatusWebhook({
      payload: {
        entry: [
          {
            changes: [
              {
                value: {
                  statuses: [
                    { id: "wamid.UNKNOWN", status: "sent", timestamp: "1" },
                  ],
                },
              },
            ],
          },
        ],
      },
      messages: createMemoryCommunicationMessageRepository(),
      events: createMemoryWebhookEventRepository(),
    });
    expect(result.unknown).toBe(1);
    expect(parseWhatsAppStatusEvents(null)).toEqual([]);
  });

  it("produit une clé d’idempotence stable sans numéro", () => {
    const key = buildOutboundIdempotencyKey({
      tenantId: TENANT,
      eventType: "guide_payment_confirmation",
      entityId: PROTECTION,
      occurrenceKey: "2026-07-26",
      recipientReference: guideRecipientReference(TENANT),
    });
    expect(key).toHaveLength(64);
    expect(key).not.toMatch(/\+/);
  });

  it("isole les tenants sur l’idempotence", async () => {
    const other = "22222222-2222-4222-8222-222222222222";
    const channels = createMemoryCommunicationChannelRepository([
      channel(),
      { ...channel(), id: "ch_b", prestataireId: other },
    ]);
    const messages = createMemoryCommunicationMessageRepository();
    const outbound = createOutboundMessageService({
      channels,
      messages,
      guideRecipientTechnicalId: "15550001111",
    });

    const a = await outbound.queueGuidePaymentConfirmation({
      tenantId: TENANT,
      protectionId: PROTECTION,
      occurrenceKey: "same",
      amountDueCents: 240_000,
      variables: { amountLabel: "1 €", clientName: "A" },
    });
    const b = await outbound.queueGuidePaymentConfirmation({
      tenantId: other,
      protectionId: PROTECTION,
      occurrenceKey: "same",
      amountDueCents: 240_000,
      variables: { amountLabel: "1 €", clientName: "B" },
    });
    expect(a.id).not.toBe(b.id);
    expect(a.tenantId).toBe(TENANT);
    expect(b.tenantId).toBe(other);
  });

  it("ne double pas l’envoi sous exécution concurrente du processor", async () => {
    const channels = createMemoryCommunicationChannelRepository([channel()]);
    const messages = createMemoryCommunicationMessageRepository();
    const outbound = createOutboundMessageService({
      channels,
      messages,
      guideRecipientTechnicalId: "15550001111",
    });
    const queued = await outbound.queueGuidePaymentConfirmation({
      tenantId: TENANT,
      protectionId: PROTECTION,
      occurrenceKey: "concurrent-1",
      amountDueCents: 240_000,
      variables: { amountLabel: "50 €", clientName: "Concurrent" },
    });

    let sendCalls = 0;
    const transport = createStubWhatsAppTransport({
      scenario: { type: "success", providerMessageId: "wamid.CONC" },
      onSend: async () => {
        sendCalls += 1;
      },
    });

    const [r1, r2] = await Promise.all([
      processOutboundMessage({
        messageId: queued.id,
        messages,
        env: stubEnv(),
        transport,
      }),
      processOutboundMessage({
        messageId: queued.id,
        messages,
        env: stubEnv(),
        transport,
      }),
    ]);

    const outcomes = [r1.outcome, r2.outcome].sort();
    expect(outcomes).toEqual(["accepted", "skipped"]);
    expect(sendCalls).toBe(1);
    const row = await messages.findByIdempotencyKey(
      TENANT,
      queued.idempotencyKey,
    );
    expect(row?.providerMessageId).toBe("wamid.CONC");
    expect(row?.id).toBe(queued.id);
  });
});

describe("G1-P supabase communication_messages", () => {
  it("insertQueued déduplique sur (tenant, idempotency_key)", async () => {
    const rows: Record<string, unknown>[] = [];

    function builder() {
      let mode: "insert" | "select" | "update" = "select";
      let insertValues: Record<string, unknown> | null = null;
      const filters: Record<string, unknown> = {};
      const api: Record<string, unknown> = {
        select() {
          mode = mode === "insert" || mode === "update" ? mode : "select";
          return api;
        },
        insert(values: Record<string, unknown>) {
          mode = "insert";
          insertValues = values;
          return api;
        },
        update(values: Record<string, unknown>) {
          mode = "update";
          insertValues = values;
          return api;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return api;
        },
        order() {
          return api;
        },
        limit() {
          return api;
        },
        async single() {
          if (mode === "insert" && insertValues) {
            const dup = rows.find(
              (r) =>
                r.tenant_id === insertValues!.tenant_id &&
                r.idempotency_key === insertValues!.idempotency_key,
            );
            if (dup) {
              return { data: null, error: { code: "23505", message: "dup" } };
            }
            const row = {
              id: `msg_${rows.length + 1}`,
              direction: "outbound",
              provider_message_id: null,
              attempt_count: 0,
              last_error_code: null,
              last_error_message: null,
              queued_at: "2026-07-26T12:00:00.000Z",
              sent_at: null,
              delivered_at: null,
              read_at: null,
              failed_at: null,
              created_at: "2026-07-26T12:00:00.000Z",
              updated_at: "2026-07-26T12:00:00.000Z",
              ...insertValues,
            };
            rows.push(row);
            return { data: row, error: null };
          }
          return { data: rows[0] ?? null, error: null };
        },
        async maybeSingle() {
          const found = rows.find((r) => {
            return Object.entries(filters).every(([k, v]) => r[k] === v);
          });
          return { data: found ?? null, error: null };
        },
      };
      return api;
    }

    const repo = createSupabaseCommunicationMessageRepository({
      from: () => builder() as never,
    });

    const input = {
      tenantId: TENANT,
      channelId: "ch_wa",
      providerKind: "whatsapp_sidian" as const,
      recipientReference: guideRecipientReference(TENANT),
      messageKind: "template",
      templateKey: "guide_payment_confirmation",
      templateLocale: "fr",
      payloadSnapshot: { business: { amountDueCents: 100 } },
      idempotencyKey: "idem_test_key_12345678",
    };

    const first = await repo.insertQueued(input);
    const second = await repo.insertQueued(input);
    expect(second.id).toBe(first.id);
    expect(rows).toHaveLength(1);
  });
});
