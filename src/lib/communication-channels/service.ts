import { CommunicationChannelError } from "./errors";
import { getProviderOrThrow, type ProviderRegistry } from "./providers/whatsapp-sidian";
import { resolveCommunicationChannel } from "./resolve";
import type {
  CommunicationChannelRepository,
  OutboundClientMessageInput,
  OutboundClientMessageResult,
} from "./types";

const FORBIDDEN_BUSINESS_KEYS = [
  "phone",
  "phoneNumber",
  "phone_number",
  "whatsappNumber",
  "whatsapp_number",
  "waId",
  "wa_id",
  "e164",
  "fromE164",
  "toE164",
  "senderNumber",
  "sender_number",
] as const;

/**
 * Garde-fou : l'API métier refuse tout champ qui ressemble à un numéro.
 */
export function assertNoPhoneInBusinessInput(
  input: Record<string, unknown>,
): void {
  for (const key of FORBIDDEN_BUSINESS_KEYS) {
    if (key in input && input[key] != null) {
      throw new CommunicationChannelError("forbidden_phone_in_business_api");
    }
  }
}

export type CommunicationOutboundService = {
  sendClientMessage(
    input: OutboundClientMessageInput,
  ): Promise<OutboundClientMessageResult>;
};

export function createCommunicationOutboundService(deps: {
  repository: CommunicationChannelRepository;
  providers: ProviderRegistry;
}): CommunicationOutboundService {
  return {
    async sendClientMessage(input) {
      assertNoPhoneInBusinessInput(
        input as unknown as Record<string, unknown>,
      );

      const body = input.body.trim();
      if (!body) {
        throw new CommunicationChannelError("send_rejected", "body vide");
      }

      const channel = await resolveCommunicationChannel(deps.repository, {
        prestataireId: input.prestataireId,
        channelId: input.channelId,
        preferredProviderKind: input.preferredProviderKind,
      });

      const provider = getProviderOrThrow(deps.providers, channel.providerKind);

      const result = await provider.send({
        channel,
        prestataireId: input.prestataireId,
        clientPayeurId: input.clientPayeurId,
        creanceId: input.creanceId,
        conversationId: input.conversationId,
        body,
        idempotencyKey: input.idempotencyKey,
      });

      return {
        channelId: channel.id,
        providerKind: channel.providerKind,
        providerMessageId: result.providerMessageId,
        acceptedAt: result.acceptedAt,
      };
    },
  };
}
