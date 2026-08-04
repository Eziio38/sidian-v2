/**
 * Barrel fixtures G1-G — idempotency.
 */

export {
  expectNoOwnerTokenLeak,
  expectNoRawPayload,
  expectNoRawSqlLeak,
  expectNoSensitiveLeak,
} from "./assertions";

export {
  CORRELATION_ID,
  FINGERPRINT_A,
  FINGERPRINT_B,
  FIXED_NOW,
  FIXED_NOW_AFTER_EXPIRY,
  FIXED_NOW_WITHIN_LEASE,
  IDEMPOTENCY_KEY,
  INVOICE_1,
  INVOICE_2,
  OUTPUT_HASH,
  OWNER_TOKEN_A,
  OWNER_TOKEN_B,
  PARAMS_HASH,
  RAW_SQL_DETAIL,
  SENSITIVE_CARD_PAN,
  SENSITIVE_RAW_TOKEN,
  SENSITIVE_STACK_FRAGMENT,
  TENANT_A_UUID,
  TENANT_B_UUID,
  TTL_SECONDS,
} from "./constants";

export {
  baseClaimInput,
  completeInput,
  conflictClaimInput,
  failInput,
  failureTerminal,
  successTerminal,
} from "./claim-inputs";

export {
  baseFingerprintSource,
  differentArgumentSource,
  differentResourceSource,
  differentTenantSource,
  differentToolVersionSource,
  reorderedArgumentsSource,
} from "./fingerprint-inputs";

export {
  createMemoryIdempotencyRepository,
} from "./memory-repository";
export type { MemoryIdempotencyRepository } from "./memory-repository";

export {
  IDEMPOTENCY_RPC,
  createSpyIdempotencyRpcClient,
  sqlUnavailableError,
} from "./supabase-rpc-mock";
export type {
  MockRpcOutcome,
  RpcCall,
  SpyIdempotencyRpcClient,
} from "./supabase-rpc-mock";
