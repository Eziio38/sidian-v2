/**
 * Idempotency Service persistant fail-closed (G1-G) — exports publics.
 * Client Supabase injecté — aucune I/O implicite.
 *
 * Injection Router :
 * ```ts
 * createToolRouter({
 *   registry,
 *   permissionService,
 *   executorResolver,
 *   auditSink,
 *   idempotencyService, // createIdempotencyService(repo) | createSupabaseIdempotencyService(client)
 * })
 * ```
 * Ordre dans `route()` après authorize :
 * fingerprint → claim → (exécuteur seulement si acquired) → complete|fail → audit.
 */

export {
  IDEMPOTENCY_ERROR_CODES,
  IDEMPOTENCY_SAFE_MESSAGES,
  IdempotencyError,
} from "./errors";
export type { IdempotencyErrorCode } from "./errors";

export {
  IDEMPOTENCY_CLAIM_DECISIONS,
  IDEMPOTENCY_SQL_CLAIM_DECISIONS,
  IDEMPOTENCY_RECORD_STATUSES,
  IDEMPOTENCY_RPC,
  AGENT_IDEMPOTENCY_RECORDS_TABLE,
  IDEMPOTENCY_DEFAULT_TTL_SECONDS,
  IDEMPOTENCY_MIN_TTL_SECONDS,
  IDEMPOTENCY_MAX_TTL_SECONDS,
} from "./types";
export type {
  IdempotencyService,
  IdempotencyClaimInput,
  IdempotencyCompleteInput,
  IdempotencyFailInput,
  IdempotencyClaimDecision,
  IdempotencyClaimDecisionKind,
  IdempotencyClaimAcquired,
  IdempotencyClaimReplaySuccess,
  IdempotencyClaimReplayFailure,
  IdempotencyClaimConflict,
  IdempotencyClaimInProgress,
  IdempotencyClaimUnavailable,
  IdempotencyFingerprintSource,
  IdempotencyTerminalResult,
  IdempotencyTerminalSuccess,
  IdempotencyTerminalFailure,
  IdempotencyResource,
  IdempotencyRecordStatus,
  IdempotencySqlClaimDecision,
  AgentMode,
  AutonomyLevel,
} from "./types";

export {
  idempotencyClaimInputSchema,
  idempotencyCompleteInputSchema,
  idempotencyFailInputSchema,
  idempotencyFingerprintSourceSchema,
  idempotencyTerminalResultSchema,
  idempotencyTerminalSuccessSchema,
  idempotencyTerminalFailureSchema,
  idempotencyResourceSchema,
  idempotencySqlClaimResponseSchema,
  idempotencySqlMutationResponseSchema,
} from "./schemas";
export type {
  ParsedIdempotencyClaimInput,
  ParsedIdempotencyCompleteInput,
  ParsedIdempotencyFailInput,
  ParsedIdempotencyFingerprintSource,
  ParsedIdempotencyTerminalResult,
  ParsedIdempotencySqlClaimResponse,
  ParsedIdempotencySqlMutationResponse,
} from "./schemas";

export {
  buildRequestFingerprint,
  buildCanonicalFingerprintPayload,
  canonicalizeForFingerprint,
  hashOwnerToken,
  hashTerminalResult,
} from "./fingerprint";

export type {
  IdempotencyRepository,
  IdempotencyRepositoryClaimParams,
  IdempotencyRepositoryClaimResult,
  IdempotencyRepositoryCompleteParams,
  IdempotencyRepositoryFailParams,
} from "./repository";
export { resourceColumns } from "./repository";

export {
  createSupabaseIdempotencyRepository,
  classifyIdempotencyRpcError,
} from "./supabase-idempotency-repository";
export type {
  IdempotencyPersistenceClient,
  IdempotencyPostgrestError,
  IdempotencyRpcResult,
} from "./supabase-idempotency-repository";

export {
  createIdempotencyService,
  createSupabaseIdempotencyService,
} from "./service";
