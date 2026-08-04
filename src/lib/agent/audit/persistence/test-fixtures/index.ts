/**
 * Barrel fixtures G1-F — persistance audit.
 */

export {
  expectMappedColumns,
  expectNoRawPayload,
  expectNoRawSqlLeak,
  expectNoSensitiveLeak,
} from "./assertions";

export {
  ACTOR_ID,
  CORRELATION_ID,
  EXECUTOR_ID,
  FIXED_NOW,
  HUMAN_VALIDATION_ID,
  IDEMPOTENCY_KEY,
  INVOICE_1,
  OUTPUT_HASH,
  PARAMS_HASH,
  RAW_SQL_DETAIL,
  SENSITIVE_CARD_PAN,
  SENSITIVE_RAW_TOKEN,
  SENSITIVE_STACK_FRAGMENT,
  TENANT_A_UUID,
  TENANT_B_UUID,
} from "./constants";

export { approvalAuditEvent, successAuditEvent } from "./events";

export {
  createSpyAuditPersistenceClient,
} from "./supabase-mock";
export type {
  InsertCall,
  MockInsertOutcome,
  SpyAuditPersistenceClient,
} from "./supabase-mock";
