import type {
  CommunicationChannel,
  CommunicationChannelRepository,
} from "../types";

function clone(channel: CommunicationChannel): CommunicationChannel {
  return {
    ...channel,
    publicMetadata: { ...channel.publicMetadata },
  };
}

export function createMemoryCommunicationChannelRepository(
  seed: CommunicationChannel[] = [],
): CommunicationChannelRepository {
  const rows = new Map(seed.map((channel) => [channel.id, clone(channel)]));

  return {
    async listByPrestataire(prestataireId) {
      return [...rows.values()]
        .filter((channel) => channel.prestataireId === prestataireId)
        .map(clone);
    },

    async getById(channelId) {
      const row = rows.get(channelId);
      return row ? clone(row) : null;
    },

    async ensureWhatsAppSidian(prestataireId) {
      const existing = [...rows.values()].find(
        (channel) =>
          channel.prestataireId === prestataireId &&
          channel.providerKind === "whatsapp_sidian" &&
          channel.providerRef === "sidian_platform",
      );
      if (existing) return clone(existing);

      const now = new Date().toISOString();
      const channel: CommunicationChannel = {
        id: `ch_wa_sidian_${prestataireId}`,
        prestataireId,
        providerKind: "whatsapp_sidian",
        status: "active",
        displayName: "WhatsApp Sidian",
        providerRef: "sidian_platform",
        isDefault: true,
        publicMetadata: {
          transport: "whatsapp",
          ownership: "sidian_platform",
        },
        activatedAt: now,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(channel.id, channel);
      return clone(channel);
    },
  };
}
