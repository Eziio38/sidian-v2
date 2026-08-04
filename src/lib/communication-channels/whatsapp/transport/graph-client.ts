import {
  WhatsAppTransportError,
  type WhatsAppErrorCategory,
  type WhatsAppTransport,
  type WhatsAppTransportSendInput,
  type WhatsAppTransportSendResult,
} from "./types";

export type GraphWhatsAppTransportConfig = {
  accessToken: string;
  graphApiVersion: string;
  /** fetch injectable (tests). */
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

function classifyHttpStatus(status: number): {
  category: WhatsAppErrorCategory;
  retryable: boolean;
} {
  if (status === 401 || status === 403) {
    return { category: "authentication_error", retryable: false };
  }
  if (status === 400 || status === 404 || status === 422) {
    return { category: "validation_error", retryable: false };
  }
  if (status === 429) {
    return { category: "rate_limited", retryable: true };
  }
  if (status >= 500) {
    return { category: "provider_unavailable", retryable: true };
  }
  return { category: "unknown", retryable: false };
}

/**
 * Client Graph API isolé — aucune structure Meta ne remonte telle quelle.
 */
export function createGraphWhatsAppTransport(
  config: GraphWhatsAppTransportConfig,
): WhatsAppTransport {
  const fetchImpl = config.fetchImpl ?? fetch;
  const now = config.now ?? (() => new Date());

  return {
    async send(
      input: WhatsAppTransportSendInput,
    ): Promise<WhatsAppTransportSendResult> {
      const url = `https://graph.facebook.com/${config.graphApiVersion}/${encodeURIComponent(input.phoneNumberId)}/messages`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), input.timeoutMs);

      try {
        const response = await fetchImpl(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
            "Content-Type": "application/json",
            ...(input.idempotencyKey
              ? { "X-Idempotency-Key": input.idempotencyKey }
              : {}),
          },
          body: JSON.stringify(input.graphBody),
          signal: controller.signal,
        });

        const rawText = await response.text();
        let json: unknown = null;
        if (rawText) {
          try {
            json = JSON.parse(rawText) as unknown;
          } catch {
            throw new WhatsAppTransportError({
              category: "unknown",
              message: "whatsapp_non_json_response",
              retryable: response.status >= 500,
              httpStatus: response.status,
            });
          }
        }

        if (!response.ok) {
          const classified = classifyHttpStatus(response.status);
          throw new WhatsAppTransportError({
            category: classified.category,
            message: `whatsapp_http_${response.status}`,
            retryable: classified.retryable,
            httpStatus: response.status,
          });
        }

        const messages = (
          json as { messages?: Array<{ id?: string }> } | null
        )?.messages;
        const providerMessageId = messages?.[0]?.id;
        if (!providerMessageId || typeof providerMessageId !== "string") {
          throw new WhatsAppTransportError({
            category: "unknown",
            message: "whatsapp_missing_message_id",
            retryable: true,
          });
        }

        return {
          providerMessageId,
          acceptedAt: now().toISOString(),
        };
      } catch (error) {
        if (error instanceof WhatsAppTransportError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new WhatsAppTransportError({
            category: "retryable",
            message: "whatsapp_timeout",
            retryable: true,
          });
        }
        throw new WhatsAppTransportError({
          category: "retryable",
          message: "whatsapp_network_error",
          retryable: true,
        });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
