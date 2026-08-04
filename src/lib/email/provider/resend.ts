import type { EmailMessage } from "../types";
import {
  EmailProviderError,
  type EmailProvider,
  type EmailProviderErrorCategory,
  type EmailProviderSendResult,
} from "./types";

export type ResendEmailProviderConfig = {
  apiKey: string;
  /** fetch injectable (tests). */
  fetchImpl?: typeof fetch;
  now?: () => Date;
  apiBaseUrl?: string;
};

function classifyHttpStatus(status: number): {
  category: EmailProviderErrorCategory;
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

function formatFrom(from: EmailMessage["from"]): string {
  if (from.name?.trim()) {
    return `${from.name.trim()} <${from.email}>`;
  }
  return from.email;
}

/**
 * Provider Resend HTTP (fetch) — aucune dépendance SDK.
 * Les erreurs ne remontent jamais le corps de réponse (PII / secrets).
 */
export function createResendEmailProvider(
  config: ResendEmailProviderConfig,
): EmailProvider {
  const fetchImpl = config.fetchImpl ?? fetch;
  const now = config.now ?? (() => new Date());
  const baseUrl = (config.apiBaseUrl ?? "https://api.resend.com").replace(
    /\/$/,
    "",
  );

  return {
    kind: "resend",
    async send(input): Promise<EmailProviderSendResult> {
      const { message, timeoutMs } = input;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const body: Record<string, unknown> = {
        from: formatFrom(message.from),
        to: [message.to.email],
        subject: message.subject,
        html: message.html,
        text: message.text,
      };

      if (message.replyTo) {
        body.reply_to = [message.replyTo];
      }
      if (message.tags && message.tags.length > 0) {
        body.tags = message.tags;
      }
      if (message.headers && Object.keys(message.headers).length > 0) {
        body.headers = message.headers;
      }

      try {
        const response = await fetchImpl(`${baseUrl}/emails`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            ...(message.idempotencyKey
              ? { "Idempotency-Key": message.idempotencyKey.slice(0, 256) }
              : {}),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        const rawText = await response.text();
        let json: unknown = null;
        if (rawText) {
          try {
            json = JSON.parse(rawText) as unknown;
          } catch {
            throw new EmailProviderError({
              category: "unknown",
              message: "email_non_json_response",
              retryable: response.status >= 500,
              httpStatus: response.status,
            });
          }
        }

        if (!response.ok) {
          const classified = classifyHttpStatus(response.status);
          throw new EmailProviderError({
            category: classified.category,
            message: `email_http_${response.status}`,
            retryable: classified.retryable,
            httpStatus: response.status,
          });
        }

        const providerMessageId = (json as { id?: unknown } | null)?.id;
        if (
          !providerMessageId ||
          typeof providerMessageId !== "string" ||
          !providerMessageId.trim()
        ) {
          throw new EmailProviderError({
            category: "unknown",
            message: "email_missing_message_id",
            retryable: true,
          });
        }

        return {
          providerMessageId,
          sentAt: now().toISOString(),
        };
      } catch (error) {
        if (error instanceof EmailProviderError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new EmailProviderError({
            category: "retryable",
            message: "email_timeout",
            retryable: true,
          });
        }
        throw new EmailProviderError({
          category: "retryable",
          message: "email_network_error",
          retryable: true,
        });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
