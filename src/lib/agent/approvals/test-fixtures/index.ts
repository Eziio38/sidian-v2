/**
 * Barrel fixtures G1-H — human approvals.
 */

export {
  expectNoRawPayload,
  expectNoRawSqlLeak,
  expectNoSecretStored,
  expectNoSensitiveLeak,
} from "./assertions";

export {
  APPROVAL_ID_UNKNOWN,
  CORRELATION_ID,
  DECIDER_ACTOR_ID,
  FINGERPRINT_A,
  FINGERPRINT_B,
  FIXED_EXPIRES_AT,
  FIXED_EXPIRES_AT_INVALID,
  FIXED_NOW,
  FIXED_NOW_AFTER_EXPIRY,
  FIXED_NOW_WITHIN_TTL,
  FULL_ARGUMENTS_PAYLOAD,
  IDEMPOTENCY_KEY_HASH,
  INVOICE_1,
  INVOICE_2,
  PARAMS_HASH,
  PARAMS_HASH_B,
  RAW_SQL_DETAIL,
  REASON_CODE_APPROVE,
  REASON_CODE_REJECT,
  REQUESTER_ACTOR_ID,
  SENSITIVE_CARD_PAN,
  SENSITIVE_RAW_TOKEN,
  SENSITIVE_STACK_FRAGMENT,
  TENANT_A_UUID,
  TENANT_B_UUID,
  TTL_SECONDS,
} from "./constants";

export {
  approveDecisionInput,
  baseConsumeInput,
  baseRequestInput,
  crossTenantConsume,
  fingerprintMismatchConsume,
  inspectInput,
  paramsMismatchConsume,
  rejectDecisionInput,
  requestWithTtl,
} from "./inputs";

export { createMemoryApprovalRepository } from "./memory-repository";
export type { MemoryApprovalRepository } from "./memory-repository";

export {
  APPROVAL_RPC,
  createSpyApprovalRpcClient,
  sqlUnavailableError,
} from "./supabase-rpc-mock";
export type {
  MockRpcOutcome,
  RpcCall,
  SpyApprovalRpcClient,
} from "./supabase-rpc-mock";
