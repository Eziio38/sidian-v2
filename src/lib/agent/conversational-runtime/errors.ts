/**
 * G1-N — codes d’erreur runtime conversationnel.
 */

export const CONVERSATIONAL_RUNTIME_ERROR_CODES = [
  "CONVERSATIONAL_SCHEMA_INVALID",
  "CONVERSATIONAL_VALIDATION_FAILED",
  "CONVERSATIONAL_PROVIDER_TIMEOUT",
  "CONVERSATIONAL_PROVIDER_ERROR",
  "CONVERSATIONAL_TENANT_FORBIDDEN",
  "CONVERSATIONAL_INJECTION_BLOCKED",
  "CONVERSATIONAL_INTERNAL_ERROR",
] as const;

export type ConversationalRuntimeErrorCode =
  (typeof CONVERSATIONAL_RUNTIME_ERROR_CODES)[number];

export class ConversationalRuntimeError extends Error {
  readonly code: ConversationalRuntimeErrorCode;
  readonly category: "business" | "technical" | "permission";
  readonly userMessage: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ConversationalRuntimeErrorCode,
    options?: {
      message?: string;
      userMessage?: string;
      category?: "business" | "technical" | "permission";
      details?: Record<string, unknown>;
    },
  ) {
    super(options?.message ?? code);
    this.name = "ConversationalRuntimeError";
    this.code = code;
    this.category =
      options?.category ??
      (code === "CONVERSATIONAL_TENANT_FORBIDDEN" ||
      code === "CONVERSATIONAL_INJECTION_BLOCKED"
        ? "permission"
        : code === "CONVERSATIONAL_SCHEMA_INVALID" ||
            code === "CONVERSATIONAL_VALIDATION_FAILED"
          ? "business"
          : "technical");
    this.userMessage =
      options?.userMessage ??
      "Le message n’a pas pu être interprété. Reformulez ou précisez.";
    this.details = options?.details;
  }
}

export function isConversationalRuntimeError(
  err: unknown,
): err is ConversationalRuntimeError {
  return err instanceof ConversationalRuntimeError;
}
