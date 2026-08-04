/**
 * Erreurs typées du runtime LLM (P0).
 * Messages sans secret, sans clé API, sans corps de réponse brut.
 */

export const LLM_ERROR_CODES = [
  "LLM_DISABLED",
  "LLM_LIVE_MISCONFIGURED",
  "LLM_PURPOSE_FORBIDDEN",
  "LLM_BUDGET_EXCEEDED",
  "LLM_TIMEOUT",
  "LLM_PROVIDER_ERROR",
  "LLM_PROVIDER_RATE_LIMITED",
  "LLM_PROVIDER_AUTH",
  "LLM_OUTPUT_INVALID",
  "LLM_RETRY_EXHAUSTED",
  "LLM_INTERNAL",
] as const;

export type LlmErrorCode = (typeof LLM_ERROR_CODES)[number];

export type LlmErrorCategory =
  | "configuration"
  | "safety"
  | "budget"
  | "timeout"
  | "provider"
  | "validation"
  | "technical";

const CODE_CATEGORY: Record<LlmErrorCode, LlmErrorCategory> = {
  LLM_DISABLED: "configuration",
  LLM_LIVE_MISCONFIGURED: "configuration",
  LLM_PURPOSE_FORBIDDEN: "safety",
  LLM_BUDGET_EXCEEDED: "budget",
  LLM_TIMEOUT: "timeout",
  LLM_PROVIDER_ERROR: "provider",
  LLM_PROVIDER_RATE_LIMITED: "provider",
  LLM_PROVIDER_AUTH: "provider",
  LLM_OUTPUT_INVALID: "validation",
  LLM_RETRY_EXHAUSTED: "provider",
  LLM_INTERNAL: "technical",
};

const RETRYABLE: ReadonlySet<LlmErrorCode> = new Set([
  "LLM_TIMEOUT",
  "LLM_PROVIDER_ERROR",
  "LLM_PROVIDER_RATE_LIMITED",
]);

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly category: LlmErrorCategory;
  readonly retryable: boolean;

  constructor(
    code: LlmErrorCode,
    options?: { message?: string; cause?: unknown },
  ) {
    super(options?.message ?? code);
    this.name = "LlmError";
    this.code = code;
    this.category = CODE_CATEGORY[code];
    this.retryable = RETRYABLE.has(code);
    if (options?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export function isLlmError(error: unknown): error is LlmError {
  return error instanceof LlmError;
}
