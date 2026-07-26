/**
 * Audit Service déterministe (G1-E) — exports publics.
 * Construction d’événements purs — aucune persistance.
 */

export {
  AUDIT_REASON_CODES,
  AUDIT_SUCCESS_REASON_CODE,
  AUDIT_BUILD_ERROR_CODES,
} from "./reason-codes";
export type {
  AuditReasonCode,
  AuditBuildErrorCode,
} from "./reason-codes";

export {
  auditBuildInputSchema,
  auditBuildContextSchema,
  auditEventSchema,
  auditActorSchema,
  auditTenantSchema,
  auditToolRefSchema,
  auditAutonomySchema,
  auditDecisionOutcomeSchema,
  auditResultKindSchema,
  auditExecutionOutcomeSchema,
  auditIdempotencyStatusSchema,
  auditReasonCodeSchema,
  auditResourceSchema,
} from "./schemas";
export type {
  ParsedAuditBuildInput,
  ParsedAuditBuildContext,
  ParsedAuditEvent,
} from "./schemas";

export { buildAuditEvent, deriveDeterministicAuditId } from "./builder";
export { createAuditService } from "./service";

export { AuditBuildError } from "./types";
export type {
  AuditService,
  AuditEvent,
  AuditBuildInput,
  AuditBuildContext,
  AuditActor,
  AuditTenant,
  AuditToolRef,
  AuditAutonomy,
  AuditResource,
  AuditDecisionOutcome,
  AuditResultKind,
  AuditExecutionOutcome,
  AuditIdempotencyStatus,
  ActorType,
  AgentMode,
  AutonomyLevel,
  ResourceKind,
} from "./types";
