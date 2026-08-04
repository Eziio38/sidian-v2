import type { EmailMessage } from "../types";
import {
  EmailProviderError,
  type EmailProvider,
  type EmailProviderErrorCategory,
  type EmailProviderSendResult,
} from "./types";

export type BrevoEmailProviderConfig = {
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

/**
 * Provider Brevo HTTP (fetch) — aucune dépendance SDK.
 *
 * Contrat : POST /v3/smtp/email, authentification par en-tête `api-key`
 * (et non `Authorization: Bearer`), corps `sender` / `to[]` / `subject` /
 * `htmlContent` / `textContent`, réponse 201 `{ messageId }`.
 *
 * Différences notables avec Resend, qui justifient un provider distinct
 * plutôt qu'un paramétrage :
 * - l'expéditeur est un objet `{ name, email }`, pas une chaîne `Nom <email>` ;
 * - les destinataires sont des objets, pas des chaînes ;
 * - l'identifiant de message est `messageId`, pas `id` ;
 * - Brevo n'expose pas d'en-tête d'idempotence : la déduplication reste donc
 *   assurée en amont par la clé d'idempotence de l'outbox.
 *
 * Comme pour Resend, aucune erreur ne remonte le corps de réponse (PII).
 */
export function createBrevoEmailProvider(
  config: BrevoEmailProviderConfig,
): EmailProvider {
  const fetchImpl = config.fetchImpl ?? fetch;
  const now = config.now ?? (() => new Date());
  const baseUrl = (config.apiBaseUrl ?? "https://api.brevo.com/v3").replace(
    /\/$/,
    "",
  );

  return {
    kind: "brevo",
    async send(input): Promise<EmailProviderSendResult> {
      const { message, timeoutMs } = input;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const sender: Record<string, string> = { email: message.from.email };
      if (message.from.name?.trim()) sender.name = message.from.name.trim();

      const recipient: Record<string, string> = { email: message.to.email };
      if (message.to.name?.trim()) recipient.name = message.to.name.trim();

      const body: Record<string, unknown> = {
        sender,
        to: [recipient],
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
      };

      // `replyTo` est une simple adresse côté domaine ; Brevo attend un objet.
      if (message.replyTo) {
        body.replyTo = { email: message.replyTo };
      }
      if (message.tags && message.tags.length > 0) {
        body.tags = message.tags;
      }
      if (message.headers && Object.keys(message.headers).length > 0) {
        body.headers = message.headers;
      }

      try {
        const response = await fetchImpl(`${baseUrl}/smtp/email`, {
          method: "POST",
          headers: {
            "api-key": config.apiKey,
            "Content-Type": "application/json",
            Accept: "application/json",
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

        const providerMessageId = (json as { messageId?: unknown } | null)
          ?.messageId;
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
