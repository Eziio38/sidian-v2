/**
 * Canaux de communication — abstraction provider.
 *
 * Règle non négociable : les services métier ne voient jamais un numéro
 * WhatsApp. Ils adressent un `channelId` / `providerKind` résolu.
 */

export const COMMUNICATION_PROVIDER_KINDS = [
  "whatsapp_sidian",
  "whatsapp_business_personal",
] as const;

export type CommunicationProviderKind =
  (typeof COMMUNICATION_PROVIDER_KINDS)[number];

export const COMMUNICATION_CHANNEL_STATUSES = [
  "inactive",
  "active",
  "degraded",
  "revoked",
] as const;

export type CommunicationChannelStatus =
  (typeof COMMUNICATION_CHANNEL_STATUSES)[number];

export const IMPLEMENTED_COMMUNICATION_PROVIDERS = [
  "whatsapp_sidian",
] as const satisfies readonly CommunicationProviderKind[];

export type ImplementedCommunicationProvider =
  (typeof IMPLEMENTED_COMMUNICATION_PROVIDERS)[number];

/** Vue métier d’un canal — aucun secret, aucun E.164. */
export type CommunicationChannel = {
  id: string;
  prestataireId: string;
  providerKind: CommunicationProviderKind;
  status: CommunicationChannelStatus;
  displayName: string;
  providerRef: string;
  isDefault: boolean;
  publicMetadata: Record<string, unknown>;
  activatedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ResolveChannelInput = {
  prestataireId: string;
  /** Si omis : canal défaut actif du prestataire. */
  channelId?: string;
  /** Filtre optionnel (ex. forcer WhatsApp). */
  preferredProviderKind?: CommunicationProviderKind;
};

export type OutboundClientMessageInput = {
  prestataireId: string;
  clientPayeurId: string;
  creanceId?: string;
  conversationId?: string;
  /** Corps déjà rédigé par la couche métier / agent. */
  body: string;
  channelId?: string;
  preferredProviderKind?: CommunicationProviderKind;
  idempotencyKey?: string;
};

export type OutboundClientMessageResult = {
  channelId: string;
  providerKind: CommunicationProviderKind;
  providerMessageId: string;
  acceptedAt: string;
};

/**
 * Entrée adaptateur — toujours via channelId.
 * Interdit : phoneNumber, waId, E.164 en entrée métier.
 */
export type ProviderSendInput = {
  channel: CommunicationChannel;
  prestataireId: string;
  clientPayeurId: string;
  creanceId?: string;
  conversationId?: string;
  body: string;
  idempotencyKey?: string;
};

export type ProviderSendResult = {
  providerMessageId: string;
  acceptedAt: string;
};

export type CommunicationProvider = {
  readonly kind: CommunicationProviderKind;
  send(input: ProviderSendInput): Promise<ProviderSendResult>;
};

export type CommunicationChannelRepository = {
  listByPrestataire(prestataireId: string): Promise<CommunicationChannel[]>;
  getById(channelId: string): Promise<CommunicationChannel | null>;
  ensureWhatsAppSidian(prestataireId: string): Promise<CommunicationChannel>;
};
