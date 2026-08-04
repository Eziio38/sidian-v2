export const PAYMENT_RUNTIME_ERROR_CODES = [
  "PAYMENTS_DISABLED",
  "CHECKLIST_INCOMPLETE",
  "INVALID_CREANCE_STATE",
  "UNSUPPORTED_CURRENCY",
  "AMOUNT_EXCEEDS_REMAINING",
  "AMOUNT_MISMATCH",
  "ACTIVE_ATTEMPT_EXISTS",
  "FOLLOWUP_BLOCKED",
  "AUTHORIZATION_INELIGIBLE",
  "SEPA_PRENOTIFICATION_REQUIRED",
  "CONNECT_NOT_PAYABLE",
  "REGLE_AUTO_DEBIT_CEILING_UNDEFINED",
  "SCOPE_MISMATCH",
  "JOB_IN_PROGRESS",
  "JOB_NOT_FOUND",
  "LEASE_LOST",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_TEMPORARY_FAILURE",
  "PROVIDER_PERMANENT_FAILURE",
  "UNKNOWN_PROVIDER_RESULT",
  "DUPLICATE_REQUEST",
  "WEBHOOK_IS_SOURCE_OF_TRUTH",
  "INBOUND_WEBHOOK_MUST_NOT_DEBIT",
] as const;

export type PaymentRuntimeErrorCode =
  (typeof PAYMENT_RUNTIME_ERROR_CODES)[number];

export type PaymentRuntimeErrorCategory = "business" | "technical";

export class PaymentRuntimeError extends Error {
  readonly code: PaymentRuntimeErrorCode;
  readonly category: PaymentRuntimeErrorCategory;
  readonly retryable: boolean;
  readonly userMessage: string;

  constructor(input: {
    code: PaymentRuntimeErrorCode;
    category: PaymentRuntimeErrorCategory;
    message: string;
    retryable?: boolean;
    userMessage?: string;
  }) {
    super(input.message);
    this.name = "PaymentRuntimeError";
    this.code = input.code;
    this.category = input.category;
    this.retryable = input.retryable ?? false;
    this.userMessage =
      input.userMessage ??
      (input.category === "business"
        ? "La tentative de paiement n’a pas pu être créée."
        : "Une erreur technique est survenue.");
  }
}

export function isPaymentRuntimeError(
  value: unknown,
): value is PaymentRuntimeError {
  return value instanceof PaymentRuntimeError;
}
