export const EMAIL_ERROR_CODES = [
  "email_invalid",
  "email_provider_disabled",
  "email_provider_misconfigured",
  "email_template_unknown",
  "email_template_locale_unsupported",
  "email_template_variable_missing",
  "email_template_variable_invalid",
  "email_url_rejected",
  "email_enqueue_rejected",
  "email_not_claimable",
  "email_max_attempts",
  "email_send_failed",
] as const;

export type EmailErrorCode = (typeof EMAIL_ERROR_CODES)[number];

export class EmailError extends Error {
  readonly code: EmailErrorCode;
  readonly details?: string;

  constructor(code: EmailErrorCode, details?: string) {
    super(details ? `${code}:${details}` : code);
    this.name = "EmailError";
    this.code = code;
    this.details = details;
  }
}

export function isEmailError(error: unknown): error is EmailError {
  return error instanceof EmailError;
}
