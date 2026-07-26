/**
 * Résolution d'identité Guide — canal + référence préenregistrée.
 * Jamais de confiance globale au numéro seul.
 */

export type CommunicationIdentity = {
  tenantId: string;
  channelId: string;
  guideId: string;
  senderReference: string;
  active: boolean;
  canConfirmPayments: boolean;
};

export type CommunicationIdentityDirectory = {
  resolve(params: {
    channelId: string;
    senderReference: string;
  }): Promise<CommunicationIdentity | null>;
  /** Résolution par expéditeur seul — sessions partielles sans reply context. */
  resolveBySender?(params: {
    senderReference: string;
  }): Promise<CommunicationIdentity | null>;
};

export function createMemoryIdentityDirectory(
  identities: CommunicationIdentity[],
): CommunicationIdentityDirectory {
  return {
    async resolve({ channelId, senderReference }) {
      return (
        identities.find(
          (row) =>
            row.channelId === channelId &&
            row.senderReference === senderReference,
        ) ?? null
      );
    },
    async resolveBySender({ senderReference }) {
      return (
        identities.find((row) => row.senderReference === senderReference) ??
        null
      );
    },
  };
}

export type AuthorizeGuideResult =
  | { ok: true; identity: CommunicationIdentity }
  | {
      ok: false;
      reason:
        | "unknown_sender"
        | "inactive"
        | "not_authorized"
        | "tenant_mismatch";
    };

export function authorizeGuideForTenant(params: {
  identity: CommunicationIdentity | null;
  tenantId: string;
}): AuthorizeGuideResult {
  if (!params.identity) return { ok: false, reason: "unknown_sender" };
  if (params.identity.tenantId !== params.tenantId) {
    return { ok: false, reason: "tenant_mismatch" };
  }
  if (!params.identity.active) return { ok: false, reason: "inactive" };
  if (!params.identity.canConfirmPayments) {
    return { ok: false, reason: "not_authorized" };
  }
  return { ok: true, identity: params.identity };
}
