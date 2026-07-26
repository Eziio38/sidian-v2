import { createGraphWhatsAppTransport } from "./graph-client";
import { createStubWhatsAppTransport } from "./stub";
import type { WhatsAppTransport } from "./types";
import { WhatsAppTransportError } from "./types";
import type { WhatsAppEnv } from "../env";

export type { WhatsAppTransport, WhatsAppTransportSendInput, WhatsAppTransportSendResult } from "./types";
export { WhatsAppTransportError, isWhatsAppTransportError } from "./types";
export { createStubWhatsAppTransport } from "./stub";
export { createGraphWhatsAppTransport } from "./graph-client";

export function createWhatsAppTransportFromEnv(
  env: WhatsAppEnv,
): WhatsAppTransport {
  if (!env.enabled || env.mode === "disabled") {
    return {
      async send() {
        throw new WhatsAppTransportError({
          category: "configuration_error",
          message: "whatsapp_provider_disabled",
          retryable: false,
        });
      },
    };
  }

  if (env.mode === "stub") {
    return createStubWhatsAppTransport();
  }

  if (!env.accessToken || !env.phoneNumberId) {
    throw new WhatsAppTransportError({
      category: "configuration_error",
      message: "whatsapp_live_misconfigured",
      retryable: false,
    });
  }

  return createGraphWhatsAppTransport({
    accessToken: env.accessToken,
    graphApiVersion: env.graphApiVersion,
  });
}
