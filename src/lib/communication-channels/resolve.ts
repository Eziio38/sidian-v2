import { CommunicationChannelError } from "./errors";
import type {
  CommunicationChannel,
  CommunicationChannelRepository,
  ResolveChannelInput,
} from "./types";

/**
 * Résout le canal à utiliser pour un envoi métier.
 * Ne retourne jamais de numéro / secret — uniquement la vue canal.
 */
export async function resolveCommunicationChannel(
  repository: CommunicationChannelRepository,
  input: ResolveChannelInput,
): Promise<CommunicationChannel> {
  if (input.channelId) {
    const channel = await repository.getById(input.channelId);
    if (!channel) {
      throw new CommunicationChannelError("channel_not_found");
    }
    if (channel.prestataireId !== input.prestataireId) {
      throw new CommunicationChannelError("channel_wrong_tenant");
    }
    if (channel.status !== "active") {
      throw new CommunicationChannelError("channel_inactive");
    }
    if (
      input.preferredProviderKind &&
      channel.providerKind !== input.preferredProviderKind
    ) {
      throw new CommunicationChannelError("channel_not_found");
    }
    return channel;
  }

  const channels = await repository.listByPrestataire(input.prestataireId);
  const active = channels.filter((channel) => channel.status === "active");

  const preferred = input.preferredProviderKind
    ? active.filter(
        (channel) => channel.providerKind === input.preferredProviderKind,
      )
    : active;

  const selected =
    preferred.find((channel) => channel.isDefault) ?? preferred[0] ?? null;

  if (!selected) {
    throw new CommunicationChannelError("no_active_channel");
  }

  return selected;
}
