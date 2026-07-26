/**
 * Barrel des fixtures mémoire G1-I — Observability.
 */

export {
  expectEvidenceIdsOnly,
  expectMetricValue,
  expectNoNeighborTenantLeak,
  expectNoRawPayload,
  expectNoRawSqlLeak,
  expectNoSensitiveLeak,
  expectStableEventCore,
} from "./assertions";

export {
  CORRELATION_ID,
  EVENT_ID_EXPLICIT,
  FIXED_NOW,
  FIXED_NOW_LATER,
  FULL_ARGUMENTS_PAYLOAD,
  RAW_SQL_DETAIL,
  SENSITIVE_CARD_PAN,
  SENSITIVE_RAW_FIELD,
  SENSITIVE_RAW_TOKEN,
  SENSITIVE_STACK_FRAGMENT,
  TENANT_A,
  TENANT_B,
  TEST_THRESHOLD_BURST,
  TEST_THRESHOLD_SINGLE,
  TOOL_ID,
  TOOL_VERSION,
  WINDOW_END,
  WINDOW_START,
} from "./constants";

export {
  approvalReplayInput,
  approvalRequiredInput,
  auditPersistenceFailureInput,
  baseRecordInput,
  blockedPermissionDeniedInput,
  crossTenantMismatchInput,
  detectionWindow,
  executorErrorInput,
  idempotencyConflictInput,
  indeterminateInput,
  invalidArgumentInput,
  nonCallableToolInput,
  successRecordInput,
} from "./inputs";

export {
  approvalConsumedWithoutExecutionEvent,
  approvalReplayEvent,
  auditFailureEvent,
  burstPermissionDenials,
  crossTenantEvent,
  defaultWindow,
  executorFailureEvent,
  idempotencyConflictEvent,
  indeterminateEvent,
  invalidArgumentEvent,
  makeEvent,
  neighborTenantDeniedEvent,
  nonCallableEvent,
  permissionDeniedEvent,
  resetEventIdSeq,
} from "./events";

export {
  createFailingResultSink,
  createSpyObservabilitySink,
  createThrowingObservabilitySink,
} from "./sink";
export type { SpyObservabilitySink } from "./sink";

export { fixtureDeriveMetrics, fixtureRunDetectors } from "./adapters";
