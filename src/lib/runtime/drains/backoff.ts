/**
 * Re-export backoff partagé drains / outbox.
 */
export {
  computeRetryDelaySeconds,
  isPermanentErrorCode,
} from "../../communication-channels/outbound/backoff";
