import { describe, expect, it } from "vitest";

import { createMemoryCommunicationChannelRepository } from "../test-fixtures/memory-repository";
import type { CommunicationChannel } from "../types";
import { createMemoryCommunicationMessageRepository } from "../outbound/memory-repository";
import { createOutboundMessageService } from "../outbound/service";
import { processOutboundMessage } from "../outbound/processor";
import { createStubWhatsAppTransport } from "../whatsapp/transport";
import { loadWhatsAppEnv } from "../whatsapp/env";
import { parseWhatsAppInboundMessages } from "../whatsapp/inbound/parse";
import { parseFrenchEuroAmount } from "./amount-parser";
import { mapExactTextToAction } from "./text-fallback";
import { mapProviderActionIdToKey } from "./actions";
import { applyGuidePaymentCommand, createInitialGuidePaymentConfirmation } from "./domain/apply";
import { createInboundCommunicationService } from "./service";
import {
  createMemoryGuidePaymentConfirmationRepository,
  createMemoryInboundMessageRepository,
  createMemoryInteractionSessionRepository,
} from "./memory-repositories";
import { createMemoryIdentityDirectory } from "./identity";
import { assertLiveWebhookPersistence } from "../whatsapp/webhook/supabase-webhook-event-repository";
import { createLiveWhatsAppWebhookDeps } from "../whatsapp/webhook/create-live-deps";

import { opaqueWhatsAppSenderReference } from "../whatsapp/inbound/sender-reference";

const TENANT = "11111111-1111-4111-8111-111111111111";
const GUIDE_WA_ID = "15550001111";
const GUIDE_SENDER_REF = opaqueWhatsAppSenderReference(GUIDE_WA_ID);
const OTHER = "22222222-2222-4222-8222-222222222222";
const PROTECTION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GUIDE = "guide-1";

function channel(tenantId = TENANT): CommunicationChannel {
  const now = "2026-07-26T12:00:00.000Z";
  return {
    id: tenantId === TENANT ? "ch_wa" : "ch_other",
    prestataireId: tenantId,
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

function stubEnv() {
  return loadWhatsAppEnv({
    SIDIAN_ENVIRONMENT: "local",
    SIDIAN_WHATSAPP_PROVIDER_ENABLED: "true",
    SIDIAN_WHATSAPP_TRANSPORT_MODE: "stub",
    SIDIAN_WHATSAPP_GUIDE_RECIPIENT_TECHNICAL_ID: "15550001111",
    SIDIAN_WHATSAPP_PHONE_NUMBER_ID: "pnid_test",
  });
}

async function seedOutboundAccepted() {
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
    occurrenceKey: "2026-07-26",
    amountDueCents: 240_000,
    variables: { amountLabel: "2 400 €", clientName: "Dupont Conseil" },
  });
  await processOutboundMessage({
    messageId: queued.id,
    messages,
    env: stubEnv(),
    transport: createStubWhatsAppTransport({
      scenario: { type: "success", providerMessageId: "wamid.OUT1" },
    }),
  });
  return { messages, outbound, queued };
}

function identities(overrides: Partial<{ tenantId: string; active: boolean; canConfirmPayments: boolean }> = {}) {
  return createMemoryIdentityDirectory([
    {
      tenantId: overrides.tenantId ?? TENANT,
      channelId: "ch_wa",
      guideId: GUIDE,
      senderReference: GUIDE_SENDER_REF,
      active: overrides.active ?? true,
      canConfirmPayments: overrides.canConfirmPayments ?? true,
    },
  ]);
}

function createService(
  messages: ReturnType<typeof createMemoryCommunicationMessageRepository>,
  idents = identities(),
) {
  return createInboundCommunicationService({
    inbound: createMemoryInboundMessageRepository(),
    sessions: createMemoryInteractionSessionRepository(),
    confirmations: createMemoryGuidePaymentConfirmationRepository(),
    outboundMessages: messages,
    identities: idents,
    guideRecipientTechnicalId: "15550001111",
  });
}

function buttonPayload(actionId: string, replyTo = "wamid.OUT1") {
  return {
    providerKind: "whatsapp_sidian" as const,
    providerEventId: `wamid:in_${actionId}_${Date.now()}`,
    providerMessageId: `in_${actionId}_${Math.random().toString(36).slice(2)}`,
    senderReference: GUIDE_SENDER_REF,
    sentAt: new Date(),
    replyToProviderMessageId: replyTo,
    interaction: {
      kind: "button" as const,
      actionKey: mapProviderActionIdToKey(actionId)!,
    },
    safePayloadSnapshot: { providerActionId: actionId },
  };
}

describe("G1-Q amount parser", () => {
  it.each([
    ["2400", 240_000],
    ["2 400", 240_000],
    ["2 400 €", 240_000],
    ["2400€", 240_000],
    ["2.400", 240_000],
    ["2 400,50", 240_050],
    ["2400.50", 240_050],
  ])("parse %s", (raw, cents) => {
    expect(parseFrenchEuroAmount(raw)).toEqual({ ok: true, amountCents: cents });
  });

  it.each(["0", "-10", "abc", "10 et 20", "$100"])("refuse %s", (raw) => {
    expect(parseFrenchEuroAmount(raw).ok).toBe(false);
  });
});

describe("G1-Q text fallback", () => {
  it("accepte formes exactes", () => {
    expect(mapExactTextToAction("OUI")).toBe("payment_received_yes");
    expect(mapExactTextToAction("non")).toBe("payment_received_no");
    expect(mapExactTextToAction("Je vérifie")).toBe("payment_received_checking");
    expect(mapExactTextToAction("partiel")).toBe("payment_received_partial");
  });

  it("refuse ambigu", () => {
    expect(mapExactTextToAction("oui merci")).toBeNull();
    expect(mapExactTextToAction("je crois que oui")).toBeNull();
  });
});

describe("G1-Q inbound parser", () => {
  it("extrait list_reply + texte", () => {
    const messages = parseWhatsAppInboundMessages({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: "wamid.IN1",
                    from: "15550001111",
                    timestamp: "1700000000",
                    type: "interactive",
                    context: { id: "wamid.OUT1" },
                    interactive: {
                      type: "list_reply",
                      list_reply: { id: "gpc_0", title: "Oui" },
                    },
                  },
                  {
                    id: "wamid.IN2",
                    from: "15550001111",
                    timestamp: "1700000001",
                    type: "text",
                    context: { id: "wamid.OUT1" },
                    text: { body: "oui" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(messages).toHaveLength(2);
    expect(messages[0].interaction).toEqual({
      kind: "button",
      actionKey: "payment_received_yes",
    });
    expect(messages[0].replyToProviderMessageId).toBe("wamid.OUT1");
    expect(JSON.stringify(messages)).not.toMatch(/ACCESS_TOKEN|Bearer/);
  });

  it("ignore payload malformé", () => {
    expect(parseWhatsAppInboundMessages(null)).toEqual([]);
    expect(parseWhatsAppInboundMessages({ entry: "x" })).toEqual([]);
  });
});

describe("G1-Q domain transitions", () => {
  it("Oui nominal + double Oui idempotent", () => {
    const base = createInitialGuidePaymentConfirmation({
      id: "1",
      tenantId: TENANT,
      protectionId: PROTECTION,
      occurrenceId: "occ",
      amountDueCents: 240_000,
      now: "2026-07-26T12:00:00.000Z",
    });
    const first = applyGuidePaymentCommand(base, {
      type: "ConfirmPaymentReceived",
      tenantId: TENANT,
      protectionId: PROTECTION,
      occurrenceId: "occ",
      confirmedByGuideId: GUIDE,
      sourceOutboundMessageId: "out",
      sourceInboundMessageId: "in",
      confirmedAt: "2026-07-26T12:01:00.000Z",
      idempotencyKey: "cmd1",
    });
    expect(first.outcome).toBe("applied");
    expect(first.record.state).toBe("confirmed_received");
    expect(first.record.autoDebitNeutralized).toBe(true);

    const second = applyGuidePaymentCommand(first.record, {
      type: "ConfirmPaymentReceived",
      tenantId: TENANT,
      protectionId: PROTECTION,
      occurrenceId: "occ",
      confirmedByGuideId: GUIDE,
      sourceOutboundMessageId: "out",
      sourceInboundMessageId: "in2",
      confirmedAt: "2026-07-26T12:02:00.000Z",
      idempotencyKey: "cmd2",
    });
    expect(second.outcome).toBe("idempotent");
  });

  it("refuse Non après Oui", () => {
    let record = createInitialGuidePaymentConfirmation({
      id: "1",
      tenantId: TENANT,
      protectionId: PROTECTION,
      occurrenceId: "occ",
      amountDueCents: 100,
      now: "2026-07-26T12:00:00.000Z",
    });
    record = applyGuidePaymentCommand(record, {
      type: "ConfirmPaymentReceived",
      tenantId: TENANT,
      protectionId: PROTECTION,
      occurrenceId: "occ",
      confirmedByGuideId: GUIDE,
      sourceOutboundMessageId: "out",
      sourceInboundMessageId: "in",
      confirmedAt: "2026-07-26T12:01:00.000Z",
      idempotencyKey: "y",
    }).record;
    const no = applyGuidePaymentCommand(record, {
      type: "ConfirmPaymentNotReceived",
      tenantId: TENANT,
      protectionId: PROTECTION,
      occurrenceId: "occ",
      confirmedByGuideId: GUIDE,
      sourceOutboundMessageId: "out",
      sourceInboundMessageId: "in2",
      confirmedAt: "2026-07-26T12:02:00.000Z",
      idempotencyKey: "n",
    });
    expect(no.outcome).toBe("rejected");
  });

  it("Je vérifie ne suspend pas l’automation", () => {
    const base = createInitialGuidePaymentConfirmation({
      id: "1",
      tenantId: TENANT,
      protectionId: PROTECTION,
      occurrenceId: "occ",
      amountDueCents: 100,
      now: "2026-07-26T12:00:00.000Z",
    });
    const result = applyGuidePaymentCommand(base, {
      type: "MarkPaymentVerificationInProgress",
      tenantId: TENANT,
      protectionId: PROTECTION,
      occurrenceId: "occ",
      confirmedByGuideId: GUIDE,
      sourceOutboundMessageId: "out",
      sourceInboundMessageId: "in",
      initiatedAt: "2026-07-26T12:01:00.000Z",
      idempotencyKey: "c",
    });
    expect(result.outcome).toBe("applied");
    expect(result.record.autoDebitNeutralized).toBe(false);
    expect(result.event).toMatchObject({ suspendsAutomation: false });

    const replay = applyGuidePaymentCommand(result.record, {
      type: "MarkPaymentVerificationInProgress",
      tenantId: TENANT,
      protectionId: PROTECTION,
      occurrenceId: "occ",
      confirmedByGuideId: GUIDE,
      sourceOutboundMessageId: "out",
      sourceInboundMessageId: "in2",
      initiatedAt: "2026-07-26T12:02:00.000Z",
      idempotencyKey: "c2",
    });
    expect(replay.outcome).toBe("idempotent");
  });
});

describe("G1-Q inbound service", () => {
  it("Oui corrélé + confirmation outbound + idempotence webhook", async () => {
    const { messages } = await seedOutboundAccepted();
    const service = createService(messages);

    const first = await service.processInboundMessage(buttonPayload("gpc_0"));
    expect(first.processingStatus).toBe("processed");
    expect(first.actionKey).toBe("payment_received_yes");
    expect(first.domainEvent?.type).toBe("PaymentConfirmedReceived");
    expect(first.confirmationQueued).toBe(true);

    const dup = await service.processInboundMessage({
      ...buttonPayload("gpc_0"),
      // force same event id
      providerMessageId: "same",
      providerEventId: "wamid:same-event",
    });
    // second call with new event
    const secondYes = await service.processInboundMessage(
      buttonPayload("gpc_0"),
    );
    expect(secondYes.detail === "idempotent" || secondYes.processingStatus === "processed").toBe(
      true,
    );

    // duplicate same provider event
    const msg = buttonPayload("gpc_0");
    msg.providerEventId = "wamid:dup-event";
    msg.providerMessageId = "dup-msg";
    const a = await service.processInboundMessage(msg);
    const b = await service.processInboundMessage(msg);
    expect(b.detail).toBe("duplicate");
    expect(a.inboundMessageId).toBe(b.inboundMessageId);
    void dup;
    void secondYes;
  });

  it("refuse outbound inconnu / sender autre tenant", async () => {
    const { messages } = await seedOutboundAccepted();
    const service = createService(messages);
    const unknown = await service.processInboundMessage(
      buttonPayload("gpc_0", "wamid.UNKNOWN"),
    );
    expect(unknown.processingStatus).toBe("unresolved");

    const cross = createService(messages, identities({ tenantId: OTHER }));
    const rejected = await cross.processInboundMessage(buttonPayload("gpc_0"));
    expect(rejected.processingStatus).toBe("rejected");
    expect(rejected.detail).toBe("tenant_mismatch");
  });

  it("Non n’exécute pas de prélèvement (pas de neutralisation forcée)", async () => {
    const { messages } = await seedOutboundAccepted();
    const confirmations = createMemoryGuidePaymentConfirmationRepository();
    const service = createInboundCommunicationService({
      inbound: createMemoryInboundMessageRepository(),
      sessions: createMemoryInteractionSessionRepository(),
      confirmations,
      outboundMessages: messages,
      identities: identities(),
      guideRecipientTechnicalId: "15550001111",
    });
    const result = await service.processInboundMessage(buttonPayload("gpc_1"));
    expect(result.processingStatus).toBe("processed");
    const state = await confirmations.findByBusinessKey({
      tenantId: TENANT,
      protectionId: PROTECTION,
      occurrenceId: "2026-07-26",
    });
    expect(state?.state).toBe("confirmed_not_received");
    expect(state?.autoDebitNeutralized).toBe(false);
  });

  it("paiement partiel bout en bout", async () => {
    const { messages } = await seedOutboundAccepted();
    const confirmations = createMemoryGuidePaymentConfirmationRepository();
    const sessions = createMemoryInteractionSessionRepository();
    const service = createInboundCommunicationService({
      inbound: createMemoryInboundMessageRepository(),
      sessions,
      confirmations,
      outboundMessages: messages,
      identities: identities(),
      guideRecipientTechnicalId: "15550001111",
    });

    const start = await service.processInboundMessage(buttonPayload("gpc_2"));
    expect(start.detail).toBe("partial_session_started");

    const amount = await service.processInboundMessage({
      providerKind: "whatsapp_sidian",
      providerEventId: "wamid:amt1",
      providerMessageId: "amt1",
      senderReference: GUIDE_SENDER_REF,
      sentAt: new Date(),
      replyToProviderMessageId: "wamid.OUT1",
      interaction: { kind: "text", text: "1 000 €" },
      safePayloadSnapshot: {},
    });
    expect(amount.processingStatus).toBe("processed");
    expect(amount.domainEvent?.type).toBe("PartialPaymentApplied");
    const state = await confirmations.findByBusinessKey({
      tenantId: TENANT,
      protectionId: PROTECTION,
      occurrenceId: "2026-07-26",
    });
    expect(state?.amountReceivedCents).toBe(100_000);
    expect(state?.state).toBe("partially_received");
  });

  it("refuse montant > solde et texte ambigu", async () => {
    const { messages } = await seedOutboundAccepted();
    const service = createService(messages);
    await service.processInboundMessage(buttonPayload("gpc_2"));
    const tooHigh = await service.processInboundMessage({
      providerKind: "whatsapp_sidian",
      providerEventId: "wamid:amt2",
      providerMessageId: "amt2",
      senderReference: GUIDE_SENDER_REF,
      sentAt: new Date(),
      replyToProviderMessageId: "wamid.OUT1",
      interaction: { kind: "text", text: "9 999 €" },
      safePayloadSnapshot: {},
    });
    expect(tooHigh.processingStatus).toBe("rejected");

    const { messages: m2 } = await seedOutboundAccepted();
    const s2 = createService(m2);
    const ambiguous = await s2.processInboundMessage({
      providerKind: "whatsapp_sidian",
      providerEventId: "wamid:amb",
      providerMessageId: "amb",
      senderReference: GUIDE_SENDER_REF,
      sentAt: new Date(),
      replyToProviderMessageId: "wamid.OUT1",
      interaction: { kind: "text", text: "je crois que oui" },
      safePayloadSnapshot: {},
    });
    expect(ambiguous.processingStatus).toBe("rejected");
  });

  it("concurrence : double claim inbound", async () => {
    const { messages } = await seedOutboundAccepted();
    const inbound = createMemoryInboundMessageRepository();
    const service = createInboundCommunicationService({
      inbound,
      sessions: createMemoryInteractionSessionRepository(),
      confirmations: createMemoryGuidePaymentConfirmationRepository(),
      outboundMessages: messages,
      identities: identities(),
      guideRecipientTechnicalId: "15550001111",
    });
    const payload = buttonPayload("gpc_0");
    payload.providerEventId = "wamid:conc";
    payload.providerMessageId = "conc";
    const [a, b] = await Promise.all([
      service.processInboundMessage(payload),
      service.processInboundMessage(payload),
    ]);
    const statuses = [a.detail, b.detail].sort();
    expect(statuses).toContain("duplicate");
  });
});

describe("G1-Q live persistence guard", () => {
  it("refuse mémoire en live", () => {
    expect(() =>
      assertLiveWebhookPersistence({
        mode: "live",
        isMemory: true,
      }),
    ).toThrow(/persistent webhook/);
  });

  it("autorise mémoire en stub", () => {
    expect(() =>
      assertLiveWebhookPersistence({
        mode: "stub",
        isMemory: true,
      }),
    ).not.toThrow();
  });

  it("createLiveWhatsAppWebhookDeps n’utilise pas la mémoire", () => {
    const store = new Map<string, Record<string, unknown>[]>();

    function builderFor(table: string) {
      const filters: Array<{ col: string; val: unknown }> = [];
      let pendingInsert: Record<string, unknown> | null = null;
      let pendingUpdate: Record<string, unknown> | null = null;
      const api: Record<string, unknown> = {
        select() {
          return api;
        },
        insert(values: Record<string, unknown>) {
          pendingInsert = values;
          return api;
        },
        update(values: Record<string, unknown>) {
          pendingUpdate = values;
          return api;
        },
        eq(col: string, val: unknown) {
          filters.push({ col, val });
          return api;
        },
        in() {
          return api;
        },
        gt() {
          return api;
        },
        order() {
          return api;
        },
        limit() {
          return api;
        },
        async maybeSingle() {
          return { data: null, error: null };
        },
        async single() {
          if (pendingInsert) {
            const row = {
              id: crypto.randomUUID(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              ...pendingInsert,
            };
            const rows = store.get(table) ?? [];
            rows.push(row);
            store.set(table, rows);
            return { data: row, error: null };
          }
          if (pendingUpdate) {
            return { data: { id: "x", ...pendingUpdate }, error: null };
          }
          return { data: null, error: { code: "PGRST116", message: "none" } };
        },
      };
      return api;
    }

    const client = {
      from(relation: string) {
        return builderFor(relation) as never;
      },
    };

    const deps = createLiveWhatsAppWebhookDeps({
      client,
      guideRecipientTechnicalId: "15550001111",
      identities: [
        {
          tenantId: TENANT,
          channelId: "ch_wa",
          guideId: GUIDE,
          senderReference: GUIDE_SENDER_REF,
          active: true,
          canConfirmPayments: true,
        },
      ],
    });

    expect(deps.eventsAreMemory).toBe(false);
    expect(deps.inboundService).not.toBeNull();
    assertLiveWebhookPersistence({
      mode: "live",
      isMemory: deps.eventsAreMemory,
    });
  });
});
