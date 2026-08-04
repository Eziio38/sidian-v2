import type { EmailMessage } from "../types";
import {
  EmailProviderError,
  type EmailProvider,
  type EmailProviderSendResult,
} from "./types";

export type StubEmailProviderScenario =
  | { type: "success"; providerMessageId?: string }
  | { type: "timeout" }
  | { type: "network" }
  | { type: "rate_limited" }
  | { type: "auth" }
  | { type: "validation"; message?: string }
  | { type: "unavailable" };

export type StubEmailProviderOptions = {
  scenario?: StubEmailProviderScenario | (() => StubEmailProviderScenario);
  now?: () => Date;
  onSend?: (message: EmailMessage) => void | Promise<void>;
};

/**
 * Provider déterministe pour tests / mode stub — aucun réseau.
 */
export function createStubEmailProvider(
  options: StubEmailProviderOptions = {},
): EmailProvider {
  const now = options.now ?? (() => new Date());

  return {
    kind: "stub",
    async send(input): Promise<EmailProviderSendResult> {
      if (options.onSend) {
        await options.onSend(input.message);
      }

      const scenario =
        typeof options.scenario === "function"
          ? options.scenario()
          : (options.scenario ?? { type: "success" });

      switch (scenario.type) {
        case "timeout":
          throw new EmailProviderError({
            category: "retryable",
            message: "email_timeout",
            retryable: true,
          });
        case "network":
          throw new EmailProviderError({
            category: "retryable",
            message: "email_network_error",
            retryable: true,
          });
        case "rate_limited":
          throw new EmailProviderError({
            category: "rate_limited",
            message: "email_rate_limited",
            retryable: true,
            httpStatus: 429,
          });
        case "auth":
          throw new EmailProviderError({
            category: "authentication_error",
            message: "email_auth_failed",
            retryable: false,
            httpStatus: 401,
          });
        case "validation":
          throw new EmailProviderError({
            category: "validation_error",
            message: scenario.message ?? "email_validation_error",
            retryable: false,
            httpStatus: 400,
          });
        case "unavailable":
          throw new EmailProviderError({
            category: "provider_unavailable",
            message: "email_unavailable",
            retryable: true,
            httpStatus: 503,
          });
        case "success":
        default:
          return {
            providerMessageId:
              scenario.providerMessageId ??
              `email_stub_${now().getTime().toString(36)}`,
            sentAt: now().toISOString(),
          };
      }
    },
  };
}
