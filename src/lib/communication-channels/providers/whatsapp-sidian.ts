import { CommunicationChannelError } from "../errors";
import type {
  CommunicationProvider,
  CommunicationProviderKind,
  ProviderSendInput,
  ProviderSendResult,
} from "../types";

/**
 * Config WhatsApp Sidian — hors couche métier.
 * Le numéro E.164 est une métadonnée de canal (env), jamais dans les inputs métier.
 *
 * Envoi réel G1-P : OutboundMessageService → processOutboundMessage → WhatsAppTransport.
 * Ce provider reste le contrat legacy sendClientMessage (body libre) pour le canal ;
 * le cas d'usage template guide_payment_confirmation passe par l'outbound outbox.
 */
export type WhatsAppSidianProviderConfig = {
  /** E.164 plateforme — métadonnée uniquement (pas clé Graph). */
  senderE164: string;
  /** @deprecated G1-P utilise SIDIAN_WHATSAPP_ACCESS_TOKEN via WhatsAppEnv. */
  apiToken?: string;
  /** Horloge injectable (tests). */
  now?: () => Date;
  /** Transport injectable (tests) — jamais appelé depuis le métier. */
  transport?: (payload: {
    fromE164: string;
    body: string;
    clientPayeurId: string;
    idempotencyKey?: string;
  }) => Promise<{ providerMessageId: string }>;
};

function assertE164(value: string): string {
  const trimmed = value.trim();
  if (!/^\+[1-9]\d{7,14}$/.test(trimmed)) {
    throw new CommunicationChannelError(
      "provider_misconfigured",
      "SIDIAN_WHATSAPP_SIDIAN_SENDER_E164 invalide",
    );
  }
  return trimmed;
}

export function createWhatsAppSidianProvider(
  config: WhatsAppSidianProviderConfig,
): CommunicationProvider {
  const senderE164 = assertE164(config.senderE164);
  const now = config.now ?? (() => new Date());

  return {
    kind: "whatsapp_sidian",
    async send(input: ProviderSendInput): Promise<ProviderSendResult> {
      if (input.channel.providerKind !== "whatsapp_sidian") {
        throw new CommunicationChannelError("provider_not_implemented");
      }
      if (input.channel.status !== "active") {
        throw new CommunicationChannelError("channel_inactive");
      }

      const transport =
        config.transport ??
        (async () => {
          // Branchement Meta Cloud API ultérieur — pas d'envoi réel ici.
          return {
            providerMessageId: `wa_sidian_stub_${now().getTime()}`,
          };
        });

      const result = await transport({
        fromE164: senderE164,
        body: input.body,
        clientPayeurId: input.clientPayeurId,
        idempotencyKey: input.idempotencyKey,
      });

      return {
        providerMessageId: result.providerMessageId,
        acceptedAt: now().toISOString(),
      };
    },
  };
}

export function loadWhatsAppSidianProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): CommunicationProvider {
  const sender = env.SIDIAN_WHATSAPP_SIDIAN_SENDER_E164;
  if (!sender) {
    throw new CommunicationChannelError(
      "provider_misconfigured",
      "SIDIAN_WHATSAPP_SIDIAN_SENDER_E164 manquant",
    );
  }

  return createWhatsAppSidianProvider({
    senderE164: sender,
    apiToken: env.SIDIAN_WHATSAPP_SIDIAN_API_TOKEN,
  });
}

export type ProviderRegistry = Partial<
  Record<CommunicationProviderKind, CommunicationProvider>
>;

export function getProviderOrThrow(
  registry: ProviderRegistry,
  kind: CommunicationProviderKind,
): CommunicationProvider {
  const provider = registry[kind];
  if (!provider) {
    throw new CommunicationChannelError("provider_not_implemented");
  }
  return provider;
}
