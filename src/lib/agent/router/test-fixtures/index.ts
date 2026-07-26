/**
 * Barrel des fixtures mémoire G1-D — Tool Router.
 */

export { createSpyAuditService } from "./audit-service";
export type { SpyAuditService } from "./audit-service";

export { createSpyAuditSink } from "./audit-sink";
export type { SpyAuditSink, SpyAuditSinkOptions } from "./audit-sink";

export { createCallLog } from "./call-log";
export type { CallLog, CallLogEntry } from "./call-log";

export {
  ACTOR_ID,
  APPROVAL_ID,
  APPROVAL_ID_ALT,
  CORRELATION_ID,
  FIXED_NOW,
  IDEMPOTENCY_KEY,
  IDEMPOTENCY_KEY_ALT,
  INVOICE_1,
  INVOICE_2,
  MISSING_INPUT_SCHEMA_ID,
  MISSING_OUTPUT_SCHEMA_ID,
  PARAMS_HASH_V1,
  REQUEST_ID,
  SENSITIVE_RAW_FIELD,
  SENSITIVE_RAW_TOKEN,
  TENANT_A,
  TENANT_A_UUID,
  TENANT_B,
  TENANT_B_UUID,
} from "./constants";

export {
  approvedOnlyDefinition,
  deprecatedWriteDefinition,
  memoryDefinitions,
  missingInputSchemaDefinition,
  missingOutputSchemaDefinition,
  productionReadDefinition,
  productionWriteDefinition,
  REGISTERED_INPUT_SCHEMA_IDS,
  REGISTERED_OUTPUT_SCHEMA_IDS,
} from "./definitions";

export {
  createBusinessExecutorError,
  createFixedResultExecutor,
  createMemoryExecutorResolver,
  createSpyExecutor,
  createTechnicalExecutorError,
  defaultExecutorCorrelationProbe,
  invalidInvoiceGetOutput,
  sensitiveInvalidOutput,
  validInvoiceGetOutput,
  validPaymentCreateAttemptOutput,
} from "./executors";
export type {
  ExecutorResolver,
  MemoryExecutorResolver,
  SpyToolExecutor,
  ToolExecutor,
  ToolExecutorExecuteInput,
} from "./executors";

export {
  createFakePermissionService,
  fakePermissionDecision,
} from "./permission-service";
export type {
  FakePermissionMode,
  FakePermissionService,
} from "./permission-service";

export {
  createSpyApprovalService,
  defaultApprovedInspection,
} from "./approval-service";
export type { SpyApprovalService } from "./approval-service";

export { createMemoryToolRegistry } from "./registry";
export type { MemoryToolRegistry } from "./registry";

export {
  baseReadRouteRequest,
  baseWriteRouteRequest,
  baseWriteRouteRequestWithApproval,
  routeContext,
} from "./requests";
export type { FixtureRouteRequest } from "./requests";

export {
  expectBlocked,
  expectNoSensitiveLeak,
  expectNoStackLeak,
  expectSuccess,
} from "./results";
export type { ToolRouteResultLike } from "./results";

export {
  createHarnessWithCustomExecutor,
  createRouterTestHarness,
  createWriteRouterTestHarness,
  createControlledIdempotencyService,
  createSpyIdempotencyService,
  createSpyObservabilityService,
} from "./harness";
export type { RouterTestHarness } from "./harness";

export type { SpyIdempotencyService } from "./idempotency-service";

export {
  createSpyObservabilitySink,
} from "./observability-service";
export type {
  SpyObservabilityService,
  SpyObservabilitySink,
} from "./observability-service";
