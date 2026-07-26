export const WHATSAPP_ERROR_CATEGORIES = [
  "retryable",
  "non_retryable",
  "configuration_error",
  "authentication_error",
  "validation_error",
  "rate_limited",
  "provider_unavailable",
  "unknown",
] as const;

export type WhatsAppErrorCategory = (typeof WHATSAPP_ERROR_CATEGORIES)[number];

export type WhatsAppTransportSendInput = {
  /** Identifiant technique Graph (phone_number_id), pas un E.164. */
  phoneNumberId: string;
  /** Destinataire technique côté transport — opaque pour le métier. */
  toTechnicalId: string;
  /** Payload déjà mappé (template Graph). */
  graphBody: Record<string, unknown>;
  idempotencyKey?: string;
  timeoutMs: number;
};

export type WhatsAppTransportSendResult = {
  providerMessageId: string;
  acceptedAt: string;
};

export type WhatsAppTransport = {
  send(
    input: WhatsAppTransportSendInput,
  ): Promise<WhatsAppTransportSendResult>;
};

export class WhatsAppTransportError extends Error {
  readonly category: WhatsAppErrorCategory;
  readonly retryable: boolean;
  readonly httpStatus?: number;

  constructor(params: {
    category: WhatsAppErrorCategory;
    message: string;
    retryable?: boolean;
    httpStatus?: number;
  }) {
    super(params.message);
    this.name = "WhatsAppTransportError";
    this.category = params.category;
    this.retryable =
      params.retryable ??
      (params.category === "retryable" ||
        params.category === "rate_limited" ||
        params.category === "provider_unavailable");
    this.httpStatus = params.httpStatus;
  }
}

export function isWhatsAppTransportError(
  error: unknown,
): error is WhatsAppTransportError {
  return error instanceof WhatsAppTransportError;
}
