/**
 * Erreurs typées du runtime notifications / lecture créance (alias invoice.get).
 */

export const NOTIFICATION_RUNTIME_ERROR_CODES = [
  "INVOICE_NOT_FOUND",
  "INVALID_ARGUMENT",
  "TEMPLATE_UNKNOWN",
  "GUIDE_ENQUEUE_UNAVAILABLE",
  "NOTIFICATION_RUNTIME_UNAVAILABLE",
  /** Émission / sync facture / export — hors MVP documenté. */
  "EXECUTOR_UNAVAILABLE",
] as const;

export type NotificationRuntimeErrorCode =
  (typeof NOTIFICATION_RUNTIME_ERROR_CODES)[number];

export type NotificationRuntimeErrorCategory = "technical" | "business";

export class NotificationRuntimeError extends Error {
  readonly category: NotificationRuntimeErrorCategory;
  readonly code: NotificationRuntimeErrorCode;
  readonly userMessage: string;

  constructor(input: {
    category: NotificationRuntimeErrorCategory;
    code: NotificationRuntimeErrorCode;
    message: string;
    userMessage?: string;
  }) {
    super(input.message);
    this.name = "NotificationRuntimeError";
    this.category = input.category;
    this.code = input.code;
    this.userMessage =
      input.userMessage ??
      (input.category === "business"
        ? "L’action n’a pas pu aboutir."
        : "Une erreur technique est survenue.");
  }
}

export function isNotificationRuntimeError(
  value: unknown,
): value is NotificationRuntimeError {
  return value instanceof NotificationRuntimeError;
}
