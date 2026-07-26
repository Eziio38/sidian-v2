/**
 * Human Approval Service persistant (G1-H) — exports publics.
 * Client Supabase injecté — aucune I/O implicite.
 *
 * ---------------------------------------------------------------------------
 * Injection Permission Service (G1-C reste pur — pas de Supabase) :
 * ---------------------------------------------------------------------------
 * ```ts
 * const inspection = await approvalService.inspect({
 *   approval_id, // seul identifiant accepté de l’appelant
 *   tenant_id,
 *   now,
 * });
 * if (!inspection.found) {
 *   // deny / require_approval — jamais de preuve déclarative
 * }
 * const human_validation = toTrustedHumanValidation(inspection);
 * permissionService.authorize({ ...request, human_validation }, { now });
 * ```
 * Le Permission Service ne consomme jamais l’approbation.
 *
 * ---------------------------------------------------------------------------
 * Injection Router (ordre recommandé) :
 * ---------------------------------------------------------------------------
 * ```ts
 * createToolRouter({
 *   registry,
 *   permissionService,
 *   approvalService, // createSupabaseHumanApprovalService(client)
 *   executorResolver,
 *   auditSink,
 *   idempotencyService,
 * })
 * ```
 * Ordre dans `route()` :
 * 1. validation requête + résolution outil + args
 * 2. fingerprint + params_hash (buildRequestFingerprint / buildParamsHash)
 * 3. inspect(approval_id) si validation requise → HumanValidationRecord de confiance
 * 4. authorize (Permission) — deny/require_approval → stop (pas claim, pas consume)
 * 5. claim idempotence
 * 6. replay/conflict/in_progress/unavailable → stop (pas consume)
 * 7. acquired + validation requise → consume atomique
 * 8. uniquement si consume.outcome === "consumed" → exécuteur
 * 9. complete/fail idempotence + audit
 */

export {
  APPROVAL_ERROR_CODES,
  APPROVAL_SAFE_MESSAGES,
  ApprovalError,
} from "./errors";
export type { ApprovalErrorCode } from "./errors";

export {
  APPROVAL_STATUSES,
  APPROVAL_DECISIONS,
  APPROVAL_SQL_CONSUME_RESULTS,
  APPROVAL_RPC,
  AGENT_HUMAN_APPROVALS_TABLE,
  APPROVAL_DEFAULT_TTL_SECONDS,
  APPROVAL_MIN_TTL_SECONDS,
  APPROVAL_MAX_TTL_SECONDS,
} from "./types";
export type {
  HumanApprovalService,
  ApprovalRequestInput,
  ApprovalRequestResult,
  ApprovalDecisionInput,
  ApprovalDecisionResult,
  ApprovalInspectionInput,
  ApprovalInspectionResult,
  ApprovalInspectionFound,
  ApprovalInspectionMissing,
  ApprovalConsumptionInput,
  ApprovalConsumptionResult,
  ApprovalConsumptionConsumed,
  ApprovalConsumptionBlocked,
  ApprovalActor,
  ApprovalResource,
  ApprovalStatus,
  ApprovalDecision,
  ApprovalSqlConsumeResult,
  AgentMode,
  ActorType,
  AutonomyLevel,
  HumanValidationRecord,
} from "./types";

export {
  approvalRequestInputSchema,
  approvalDecisionInputSchema,
  approvalInspectionInputSchema,
  approvalConsumptionInputSchema,
  approvalActorSchema,
  approvalResourceSchema,
  approvalSqlCreateResponseSchema,
  approvalSqlDecideResponseSchema,
  approvalSqlStatusResponseSchema,
  approvalSqlConsumeResponseSchema,
  approvalSqlRowPayloadSchema,
} from "./schemas";
export type {
  ParsedApprovalRequestInput,
  ParsedApprovalDecisionInput,
  ParsedApprovalInspectionInput,
  ParsedApprovalConsumptionInput,
} from "./schemas";

export {
  buildRequestFingerprint,
  buildCanonicalFingerprintPayload,
  canonicalizeForFingerprint,
  buildParamsHash,
  hashIdempotencyKey,
  hashOwnerToken,
  hashTerminalResult,
} from "./fingerprint";
export type { ApprovalFingerprintSource } from "./fingerprint";

export type {
  ApprovalRepository,
  ApprovalRepositoryCreateParams,
  ApprovalRepositoryCreateResult,
  ApprovalRepositoryDecideParams,
  ApprovalRepositoryDecideResult,
  ApprovalRepositoryInspectParams,
  ApprovalRepositoryInspectResult,
  ApprovalRepositoryConsumeParams,
  ApprovalRepositoryConsumeResult,
} from "./repository";
export { resourceColumns } from "./repository";

export {
  createSupabaseApprovalRepository,
  classifyApprovalRpcError,
} from "./supabase-approval-repository";
export type {
  ApprovalPersistenceClient,
  ApprovalPostgrestError,
  ApprovalRpcResult,
} from "./supabase-approval-repository";

export {
  createHumanApprovalService,
  createSupabaseHumanApprovalService,
  toTrustedHumanValidation,
} from "./service";
