/**
 * Tests P0 Runtime — invoice.get / notification.generate_draft / Guide enqueue.
 */

import { describe, expect, it } from "vitest";

import { createOutboundMessageService } from "@/lib/communication-channels/outbound/service";
import { createMemoryCommunicationMessageRepository } from "@/lib/communication-channels/outbound/memory-repository";
import { createMemoryCommunicationChannelRepository } from "@/lib/communication-channels/test-fixtures/memory-repository";
import { isToolExecutorError } from "@/lib/agent/router/executor";

import { createMemoryCreanceLookup } from "./creance-lookup";
import { createGuideNotificationService } from "./guide-confirmation";
import { createInvoiceGetService } from "./invoice-get";
import { createNotificationDraftService } from "./notification-draft";
import { createNotificationRuntimeExecutors } from "./executors";
import { OUT_OF_SCOPE_P0 } from "./types";
import { isNotificationRuntimeError } from "./errors";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CREANCE_ID = "33333333-3333-4333-8333-333333333333";

function seedLookup() {
  return createMemoryCreanceLookup([
    {
      id: CREANCE_ID,
      tenantId: TENANT,
      amountCents: 12_500,
      currency: "EUR",
      status: "OUVERTE",
      dueDate: "2026-08-01",
      clientName: "Dupont SAS",
      libelle: "Presta juillet",
    },
  ]);
}

describe("P0 runtime notifications — invoice.get", () => {
  it("lit une créance tenant-scopée (alias invoice_id)", async () => {
    const service = createInvoiceGetService(seedLookup());
    const result = await service.get({
      tenantId: TENANT,
      invoiceId: CREANCE_ID,
    });
    expect(result).toEqual({
      invoice_id: CREANCE_ID,
      amount_cents: 12_500,
      currency: "EUR",
      status: "OUVERTE",
    });
  });

  it("refuse le cross-tenant", async () => {
    const service = createInvoiceGetService(seedLookup());
    await expect(
      service.get({ tenantId: OTHER, invoiceId: CREANCE_ID }),
    ).rejects.toMatchObject({ code: "INVOICE_NOT_FOUND" });
  });
});

describe("P0 runtime notifications — generate_draft", () => {
  it("produit un brouillon Guide sans envoi", async () => {
    const service = createNotificationDraftService(seedLookup());
    const draft = await service.generateDraft({
      tenantId: TENANT,
      invoiceId: CREANCE_ID,
      templateId: "guide_payment_confirmation",
    });
    expect(draft.template_id).toBe("guide_payment_confirmation");
    expect(draft.body_preview).toContain("Dupont SAS");
    expect(draft.body_preview).toContain("125,00 €");
  });

  it("refuse un template inconnu", async () => {
    const service = createNotificationDraftService(seedLookup());
    await expect(
      service.generateDraft({
        tenantId: TENANT,
        invoiceId: CREANCE_ID,
        templateId: "ledger_dump",
      }),
    ).rejects.toMatchObject({ code: "TEMPLATE_UNKNOWN" });
  });

  it("refuse une locale hors fr", async () => {
    const service = createNotificationDraftService(seedLookup());
    await expect(
      service.generateDraft({
        tenantId: TENANT,
        invoiceId: CREANCE_ID,
        templateId: "reminder_before_due",
        locale: "en",
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });
});

describe("P0 runtime notifications — Guide enqueue WhatsApp", () => {
  it("met en file guide_payment_confirmation via outbox G1-P", async () => {
    const channels = createMemoryCommunicationChannelRepository();
    await channels.ensureWhatsAppSidian(TENANT);
    const messages = createMemoryCommunicationMessageRepository();
    const outbound = createOutboundMessageService({
      channels,
      messages,
      guideRecipientTechnicalId: "guide_tech_1",
    });
    const guide = createGuideNotificationService({ outbound });

    const row = await guide.enqueuePaymentConfirmation({
      tenantId: TENANT,
      protectionId: CREANCE_ID,
      occurrenceKey: "2026-08-01",
      amountDueCents: 12_500,
      variables: {
        amountLabel: "125,00 €",
        clientName: "Dupont SAS",
      },
    });

    expect(row.status).toBe("queued");
    expect(row.templateKey).toBe("guide_payment_confirmation");
  });

  it("fail-closed si outbound absent", async () => {
    const guide = createGuideNotificationService({ outbound: null });
    await expect(
      guide.enqueuePaymentConfirmation({
        tenantId: TENANT,
        protectionId: CREANCE_ID,
        occurrenceKey: "2026-08-01",
        amountDueCents: 12_500,
        variables: { amountLabel: "125,00 €", clientName: "Dupont SAS" },
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        isNotificationRuntimeError(err) &&
        err.code === "GUIDE_ENQUEUE_UNAVAILABLE",
    );
  });
});

describe("P0 runtime notifications — executors", () => {
  it("câble invoice.get et notification.generate_draft", async () => {
    const lookup = seedLookup();
    const resolve = createNotificationRuntimeExecutors({
      invoiceGet: createInvoiceGetService(lookup),
      notificationDraft: createNotificationDraftService(lookup),
    });

    const invoice = resolve("invoice.get", "1.0.0");
    const draft = resolve("notification.generate_draft", "1.0.0");
    expect(invoice).toBeTruthy();
    expect(draft).toBeTruthy();
    expect(resolve("payment.create_attempt", "1.0.0")).toBeUndefined();

    const invoiceOut = await invoice!.execute({
      arguments: { invoice_id: CREANCE_ID },
      actor: { actor_id: "actor_a", actor_type: "human" },
      tenant: { tenant_id: TENANT },
      correlation_id: "corr_notif_1",
    });
    expect(invoiceOut).toMatchObject({
      invoice_id: CREANCE_ID,
      amount_cents: 12_500,
    });

    const draftOut = await draft!.execute({
      arguments: {
        invoice_id: CREANCE_ID,
        template_id: "reminder_before_due",
      },
      actor: { actor_id: "actor_a", actor_type: "human" },
      tenant: { tenant_id: TENANT },
      correlation_id: "corr_notif_2",
    });
    expect(draftOut).toMatchObject({
      template_id: "reminder_before_due",
    });
  });

  it("ignore tenant_id fourni dans les arguments (TrustedExecutionContext)", async () => {
    const lookup = seedLookup();
    const resolve = createNotificationRuntimeExecutors({
      invoiceGet: createInvoiceGetService(lookup),
      notificationDraft: createNotificationDraftService(lookup),
    });
    const executor = resolve("invoice.get", "1.0.0")!;

    try {
      await executor.execute({
        arguments: {
          invoice_id: CREANCE_ID,
          tenant_id: OTHER,
        },
        actor: { actor_id: "actor_a", actor_type: "human" },
        tenant: { tenant_id: OTHER },
        correlation_id: "corr_poison",
      });
      expect.unreachable("doit échouer not found");
    } catch (err) {
      expect(isToolExecutorError(err)).toBe(true);
      if (isToolExecutorError(err)) {
        expect(err.code).toBe("INVOICE_NOT_FOUND");
      }
    }
  });
});

describe("P0 runtime notifications — hors scope documenté", () => {
  it("marque émission / sync / exports hors MVP", () => {
    expect(OUT_OF_SCOPE_P0.invoice_emission).toBe(true);
    expect(OUT_OF_SCOPE_P0.invoice_sync_pennylane).toBe(true);
    expect(OUT_OF_SCOPE_P0.accounting_export).toBe(true);
    expect(OUT_OF_SCOPE_P0.account_data_export).toBe(true);
  });
});
