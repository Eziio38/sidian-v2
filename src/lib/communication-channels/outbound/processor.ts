import type { WhatsAppEnv } from "../whatsapp/env";
import { withGraphRecipient } from "../whatsapp/templates/registry";
import {
  createWhatsAppTransportFromEnv,
  isWhatsAppTransportError,
  type WhatsAppTransport,
} from "../whatsapp/transport";
import { computeRetryDelaySeconds } from "./backoff";
import {
  MAX_SEND_ATTEMPTS,
  type CommunicationMessageRecord,
  type CommunicationMessageRepository,
} from "./types";

export type ProcessOutboundResult =
  | { outcome: "accepted"; message: CommunicationMessageRecord }
  | {
      outcome: "failed";
      message: CommunicationMessageRecord;
      retryable: boolean;
    }
  | { outcome: "skipped"; reason: string };

/**
 * Traite un message queued → sending → accepted|failed.
 * Retries bornés : MAX_SEND_ATTEMPTS (1 initiale + 3).
 * Jamais de second message logique : même idempotency_key / même row.
 *
 * Si `alreadyClaimed` est fourni (drain batch SQL), le claim est sauté.
 */
export async function processOutboundMessage(params: {
  messageId: string;
  messages: CommunicationMessageRepository;
  transport?: WhatsAppTransport;
  env: WhatsAppEnv;
  phoneNumberId?: string;
  /** Message déjà claimé via claimQueuedBatch (lease actif). */
  alreadyClaimed?: CommunicationMessageRecord;
}): Promise<ProcessOutboundResult> {
  const claimed =
    params.alreadyClaimed ??
    (await params.messages.claimForSending(params.messageId));
  if (!claimed) {
    return { outcome: "skipped", reason: "not_claimable" };
  }

  const leaseToken = claimed.leaseToken;

  if (claimed.attemptCount > MAX_SEND_ATTEMPTS) {
    const failed = await params.messages.finalizeFailed(
      claimed.id,
      "max_attempts",
      "max_attempts_exceeded",
      claimed.attemptCount,
      leaseToken,
    );
    return { outcome: "failed", message: failed, retryable: false };
  }

  const transport =
    params.transport ?? createWhatsAppTransportFromEnv(params.env);
  const phoneNumberId = params.phoneNumberId ?? params.env.phoneNumberId;

  if (!phoneNumberId && params.env.mode === "live") {
    const failed = await params.messages.finalizeFailed(
      claimed.id,
      "configuration_error",
      "phone_number_id_missing",
      claimed.attemptCount,
      leaseToken,
    );
    return { outcome: "failed", message: failed, retryable: false };
  }

  const snapshot = claimed.payloadSnapshot;
  const graphBody = snapshot.graphBody as Record<string, unknown> | undefined;
  // Destinataire technique : config adaptateur uniquement — jamais depuis le snapshot
  // (évite PII E.164 / wa_id lisible via SELECT tenant).
  const toTechnicalId = params.env.guideRecipientTechnicalId;

  if (!graphBody || !toTechnicalId) {
    const failed = await params.messages.finalizeFailed(
      claimed.id,
      "validation_error",
      "payload_incomplete",
      claimed.attemptCount,
      leaseToken,
    );
    return { outcome: "failed", message: failed, retryable: false };
  }

  try {
    const result = await transport.send({
      phoneNumberId: phoneNumberId ?? "stub_phone_number_id",
      toTechnicalId,
      graphBody: withGraphRecipient(graphBody, toTechnicalId),
      idempotencyKey: claimed.idempotencyKey,
      timeoutMs: params.env.httpTimeoutMs,
    });

    const accepted = await params.messages.markAccepted(
      claimed.id,
      result.providerMessageId,
      result.acceptedAt,
      leaseToken,
    );
    return { outcome: "accepted", message: accepted };
  } catch (error) {
    const category = isWhatsAppTransportError(error)
      ? error.category
      : "unknown";
    const retryable = isWhatsAppTransportError(error)
      ? error.retryable && claimed.attemptCount < MAX_SEND_ATTEMPTS
      : claimed.attemptCount < MAX_SEND_ATTEMPTS;
    const code = isWhatsAppTransportError(error)
      ? error.message
      : "unknown_error";

    if (retryable) {
      const requeued = await params.messages.markFailed(
        claimed.id,
        category,
        code,
        claimed.attemptCount,
        {
          leaseToken,
          retryDelaySeconds: computeRetryDelaySeconds(claimed.attemptCount),
        },
      );
      return { outcome: "failed", message: requeued, retryable: true };
    }

    const failed = await params.messages.finalizeFailed(
      claimed.id,
      category,
      code,
      claimed.attemptCount,
      leaseToken,
    );
    return { outcome: "failed", message: failed, retryable: false };
  }
}

export async function processQueuedOutboundBatch(params: {
  messages: CommunicationMessageRepository;
  env: WhatsAppEnv;
  transport?: WhatsAppTransport;
  limit?: number;
  leaseSeconds?: number;
}): Promise<ProcessOutboundResult[]> {
  const claimed = await params.messages.claimQueuedBatch({
    limit: params.limit ?? 10,
    leaseSeconds: params.leaseSeconds ?? 60,
  });
  const results: ProcessOutboundResult[] = [];
  for (const message of claimed) {
    results.push(
      await processOutboundMessage({
        messageId: message.id,
        messages: params.messages,
        env: params.env,
        transport: params.transport,
        alreadyClaimed: message,
      }),
    );
  }
  return results;
}
