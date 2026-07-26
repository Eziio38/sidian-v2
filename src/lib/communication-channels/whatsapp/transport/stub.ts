import type {
  WhatsAppTransport,
  WhatsAppTransportSendInput,
  WhatsAppTransportSendResult,
} from "./types";
import { WhatsAppTransportError } from "./types";

export type StubTransportScenario =
  | { type: "success"; providerMessageId?: string }
  | { type: "timeout" }
  | { type: "network" }
  | { type: "rate_limited" }
  | { type: "auth" }
  | { type: "validation"; message?: string }
  | { type: "unavailable" };

export type StubWhatsAppTransportOptions = {
  scenario?: StubTransportScenario | (() => StubTransportScenario);
  now?: () => Date;
  onSend?: (input: WhatsAppTransportSendInput) => void | Promise<void>;
};

/**
 * Transport déterministe pour tests / mode stub — aucun réseau.
 */
export function createStubWhatsAppTransport(
  options: StubWhatsAppTransportOptions = {},
): WhatsAppTransport {
  const now = options.now ?? (() => new Date());

  return {
    async send(
      input: WhatsAppTransportSendInput,
    ): Promise<WhatsAppTransportSendResult> {
      if (options.onSend) {
        await options.onSend(input);
      }

      const scenario =
        typeof options.scenario === "function"
          ? options.scenario()
          : (options.scenario ?? { type: "success" });

      switch (scenario.type) {
        case "timeout":
          throw new WhatsAppTransportError({
            category: "retryable",
            message: "whatsapp_timeout",
            retryable: true,
          });
        case "network":
          throw new WhatsAppTransportError({
            category: "retryable",
            message: "whatsapp_network_error",
            retryable: true,
          });
        case "rate_limited":
          throw new WhatsAppTransportError({
            category: "rate_limited",
            message: "whatsapp_rate_limited",
            retryable: true,
            httpStatus: 429,
          });
        case "auth":
          throw new WhatsAppTransportError({
            category: "authentication_error",
            message: "whatsapp_auth_failed",
            retryable: false,
            httpStatus: 401,
          });
        case "validation":
          throw new WhatsAppTransportError({
            category: "validation_error",
            message: scenario.message ?? "whatsapp_validation_error",
            retryable: false,
            httpStatus: 400,
          });
        case "unavailable":
          throw new WhatsAppTransportError({
            category: "provider_unavailable",
            message: "whatsapp_unavailable",
            retryable: true,
            httpStatus: 503,
          });
        case "success":
        default: {
          void input;
          return {
            providerMessageId:
              scenario.providerMessageId ??
              `wa_stub_${now().getTime().toString(36)}`,
            acceptedAt: now().toISOString(),
          };
        }
      }
    },
  };
}
