import { describe, expect, it, vi } from "vitest";

import {
  CommunicationChannelError,
  assertNoPhoneInBusinessInput,
  createCommunicationOutboundService,
  createMemoryCommunicationChannelRepository,
  createWhatsAppSidianProvider,
  resolveCommunicationChannel,
} from "./index";
import type { CommunicationChannel } from "./types";

const PRESTATAIRE_A = "11111111-1111-4111-8111-111111111111";
const PRESTATAIRE_B = "22222222-2222-4222-8222-222222222222";
const CLIENT_A = "33333333-3333-4333-8333-333333333333";

function activeWhatsAppSidian(
  overrides: Partial<CommunicationChannel> = {},
): CommunicationChannel {
  const now = "2026-07-26T12:00:00.000Z";
  return {
    id: "ch_default",
    prestataireId: PRESTATAIRE_A,
    providerKind: "whatsapp_sidian",
    status: "active",
    displayName: "WhatsApp Sidian",
    providerRef: "sidian_platform",
    isDefault: true,
    publicMetadata: { transport: "whatsapp", ownership: "sidian_platform" },
    activatedAt: now,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("communication channels", () => {
  it("résout le canal défaut sans exposer de numéro", async () => {
    const repository = createMemoryCommunicationChannelRepository([
      activeWhatsAppSidian(),
    ]);

    const channel = await resolveCommunicationChannel(repository, {
      prestataireId: PRESTATAIRE_A,
    });

    expect(channel.id).toBe("ch_default");
    expect(channel.providerKind).toBe("whatsapp_sidian");
    expect(JSON.stringify(channel)).not.toMatch(/\+\d{8,}/);
  });

  it("refuse un canal d’un autre prestataire", async () => {
    const repository = createMemoryCommunicationChannelRepository([
      activeWhatsAppSidian({ prestataireId: PRESTATAIRE_B }),
    ]);

    await expect(
      resolveCommunicationChannel(repository, {
        prestataireId: PRESTATAIRE_A,
        channelId: "ch_default",
      }),
    ).rejects.toMatchObject({ code: "channel_wrong_tenant" });
  });

  it("envoie via le provider résolu sans numéro dans l’API métier", async () => {
    const transport = vi.fn(async () => ({
      providerMessageId: "wa_msg_1",
    }));
    const repository = createMemoryCommunicationChannelRepository([
      activeWhatsAppSidian(),
    ]);
    const service = createCommunicationOutboundService({
      repository,
      providers: {
        whatsapp_sidian: createWhatsAppSidianProvider({
          senderE164: "+33600000000",
          transport,
        }),
      },
    });

    const result = await service.sendClientMessage({
      prestataireId: PRESTATAIRE_A,
      clientPayeurId: CLIENT_A,
      body: "Voici votre lien de paiement.",
    });

    expect(result.channelId).toBe("ch_default");
    expect(result.providerKind).toBe("whatsapp_sidian");
    expect(result.providerMessageId).toBe("wa_msg_1");
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        fromE164: "+33600000000",
        clientPayeurId: CLIENT_A,
        body: "Voici votre lien de paiement.",
      }),
    );
  });

  it("rejette toute tentative d’injecter un numéro dans l’API métier", () => {
    expect(() =>
      assertNoPhoneInBusinessInput({
        prestataireId: PRESTATAIRE_A,
        phoneNumber: "+33600000000",
      }),
    ).toThrow(CommunicationChannelError);
  });

  it("provisionne WhatsApp Sidian par défaut (opaque)", async () => {
    const repository = createMemoryCommunicationChannelRepository();
    const channel = await repository.ensureWhatsAppSidian(PRESTATAIRE_A);

    expect(channel.providerKind).toBe("whatsapp_sidian");
    expect(channel.providerRef).toBe("sidian_platform");
    expect(channel.providerRef).not.toMatch(/^\+/);
    expect(channel.isDefault).toBe(true);
  });
});
