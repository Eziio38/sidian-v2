export const EMAIL_PROVIDER_ERROR_CATEGORIES = [
  "retryable",
  "non_retryable",
  "configuration_error",
  "authentication_error",
  "validation_error",
  "rate_limited",
  "provider_unavailable",
  "unknown",
] as const;

export type EmailProviderErrorCategory =
  (typeof EMAIL_PROVIDER_ERROR_CATEGORIES)[number];

export type EmailProviderSendResult = {
  providerMessageId: string;
  sentAt: string;
};

/**
 * Abstraction provider — le domaine n'importe jamais Resend / vendor.
 */
export type EmailProvider = {
  readonly kind: "resend" | "brevo" | "stub";
  send(input: {
    message: import("../types").EmailMessage;
    timeoutMs: number;
  }): Promise<EmailProviderSendResult>;
};

export class EmailProviderError extends Error {
  readonly category: EmailProviderErrorCategory;
  readonly retryable: boolean;
  readonly httpStatus?: number;

  constructor(params: {
    category: EmailProviderErrorCategory;
    message: string;
    retryable?: boolean;
    httpStatus?: number;
  }) {
    super(params.message);
    this.name = "EmailProviderError";
    this.category = params.category;
    this.retryable =
      params.retryable ??
      (params.category === "retryable" ||
        params.category === "rate_limited" ||
        params.category === "provider_unavailable");
    this.httpStatus = params.httpStatus;
  }
}

export function isEmailProviderError(
  error: unknown,
): error is EmailProviderError {
  return error instanceof EmailProviderError;
}
