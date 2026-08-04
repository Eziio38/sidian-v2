import type { EmailEnv } from "../env";
import { createBrevoEmailProvider } from "./brevo";
import { createResendEmailProvider } from "./resend";
import { createStubEmailProvider } from "./stub";
import {
  EmailProviderError,
  type EmailProvider,
} from "./types";

export type { EmailProvider, EmailProviderSendResult } from "./types";
export {
  EmailProviderError,
  isEmailProviderError,
  EMAIL_PROVIDER_ERROR_CATEGORIES,
} from "./types";
export type { EmailProviderErrorCategory } from "./types";
export { createStubEmailProvider } from "./stub";
export type {
  StubEmailProviderOptions,
  StubEmailProviderScenario,
} from "./stub";
export { createResendEmailProvider } from "./resend";
export type { ResendEmailProviderConfig } from "./resend";
export { createBrevoEmailProvider } from "./brevo";
export type { BrevoEmailProviderConfig } from "./brevo";

export function createEmailProviderFromEnv(env: EmailEnv): EmailProvider {
  if (!env.enabled || env.mode === "disabled") {
    return {
      kind: "stub",
      async send() {
        throw new EmailProviderError({
          category: "configuration_error",
          message: "email_provider_disabled",
          retryable: false,
        });
      },
    };
  }

  if (env.mode === "stub") {
    return createStubEmailProvider();
  }

  if (!env.apiKey || !env.fromAddress) {
    throw new EmailProviderError({
      category: "configuration_error",
      message: "email_live_misconfigured",
      retryable: false,
    });
  }

  // Le vendor est choisi explicitement : deux contrats HTTP différents
  // (en-tête d'authentification, forme du corps, nom de l'identifiant de
  // message) qu'aucun paramétrage commun ne réconcilierait honnêtement.
  if (env.providerKind === "brevo") {
    return createBrevoEmailProvider({ apiKey: env.apiKey });
  }

  return createResendEmailProvider({
    apiKey: env.apiKey,
  });
}
