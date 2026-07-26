export const COMMUNICATION_CHANNEL_ERROR_CODES = [
  "channel_not_found",
  "channel_inactive",
  "channel_wrong_tenant",
  "no_active_channel",
  "provider_not_implemented",
  "provider_misconfigured",
  "forbidden_phone_in_business_api",
  "send_rejected",
] as const;

export type CommunicationChannelErrorCode =
  (typeof COMMUNICATION_CHANNEL_ERROR_CODES)[number];

export class CommunicationChannelError extends Error {
  readonly code: CommunicationChannelErrorCode;

  constructor(code: CommunicationChannelErrorCode, message?: string) {
    super(message ?? code);
    this.name = "CommunicationChannelError";
    this.code = code;
  }
}

export function isCommunicationChannelError(
  error: unknown,
): error is CommunicationChannelError {
  return error instanceof CommunicationChannelError;
}
