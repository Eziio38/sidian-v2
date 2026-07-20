import "server-only";

export class StripeDomainError extends Error {
  readonly code: string;
  readonly disposition?: "retryable" | "terminal" | "lease_lost";

  constructor(
    code: string,
    message?: string,
    disposition?: "retryable" | "terminal" | "lease_lost",
  ) {
    super(message ?? code);
    this.name = "StripeDomainError";
    this.code = code;
    this.disposition = disposition;
  }
}

export type StripeFailureClassification = {
  code: string;
  disposition: "retryable" | "terminal" | "lease_lost";
};

const RETRYABLE_STRIPE_TYPES = new Set([
  "StripeAPIError",
  "StripeConnectionError",
  "StripeRateLimitError",
]);

const TERMINAL_WEBHOOK_CODES = new Set([
  "stripe_connected_scope_mismatch",
  "stripe_account_scope_mismatch",
  "webhook_account_object_invalid",
  "webhook_account_metadata_invalid",
  "webhook_account_environment_mismatch",
  "webhook_prestataire_scope_mismatch",
  "webhook_event_identity_mismatch",
]);

export function classifyStripeFailure(error: unknown): StripeFailureClassification {
  if (error instanceof StripeDomainError) {
    if (error.disposition) {
      return { code: error.code, disposition: error.disposition };
    }
    if (error.code === "webhook_lease_lost") {
      return { code: error.code, disposition: "lease_lost" };
    }
    if (TERMINAL_WEBHOOK_CODES.has(error.code)) {
      return { code: error.code, disposition: "terminal" };
    }
    return { code: error.code, disposition: "retryable" };
  }

  if (error && typeof error === "object" && "type" in error) {
    const type = String((error as { type?: string }).type ?? "stripe_error");
    return {
      code: `stripe_${type}`,
      disposition: RETRYABLE_STRIPE_TYPES.has(type) ? "retryable" : "terminal",
    };
  }

  return { code: "stripe_unexpected", disposition: "retryable" };
}

export function toSafeStripeError(error: unknown): StripeDomainError {
  if (error instanceof StripeDomainError) {
    return error;
  }

  if (error && typeof error === "object" && "type" in error) {
    const type = String((error as { type?: string }).type ?? "stripe_error");
    const disposition = RETRYABLE_STRIPE_TYPES.has(type)
      ? "retryable"
      : "terminal";
    // Ne jamais propager message/secret Stripe brut au client
    return new StripeDomainError(
      `stripe_${type}`,
      "Erreur Stripe normalisée.",
      disposition,
    );
  }

  if (error instanceof Error) {
    return new StripeDomainError("stripe_unexpected", "Erreur Stripe normalisée.");
  }

  return new StripeDomainError("stripe_unexpected");
}
