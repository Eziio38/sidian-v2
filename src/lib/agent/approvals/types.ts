/**
 * Types du Human Approval Service persistant (G1-H).
 * Alignés sur G1-C (permissions), G1-D (router) et G1-G (fingerprint).
 * Aucun client Supabase global — injection via repository.
 */

import type {
  AgentMode,
  ActorType,
  AutonomyLevel,
  HumanValidationRecord,
  PermissionResource,
} from "@/lib/agent/permissions/types";

import type { ApprovalErrorCode } from "./errors";

export type { AgentMode, ActorType, AutonomyLevel, ApprovalErrorCode };
export type ApprovalResource = PermissionResource;
export type { HumanValidationRecord };

/** Statuts persistés (migration parallèle G1-H). */
export const APPROVAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "consumed",
  "cancelled",
] as const;

export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/** Décision humaine API (≠ statut persisté). */
export const APPROVAL_DECISIONS = ["approve", "reject"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/**
 * Résultats atomiques de `consume_human_approval` (libellés SQL).
 * `autonomy_mismatch` est accepté s’il est renvoyé par la RPC.
 */
export const APPROVAL_SQL_CONSUME_RESULTS = [
  "consumed",
  "pending",
  "rejected",
  "expired",
  "already_consumed",
  "scope_mismatch",
  "params_mismatch",
  "autonomy_mismatch",
  "not_found",
  "unavailable",
] as const;

export type ApprovalSqlConsumeResult =
  (typeof APPROVAL_SQL_CONSUME_RESULTS)[number];

/** Acteur demandeur — jamais de preuve d’identité brute. */
export type ApprovalActor = {
  actor_id: string;
  actor_type: ActorType;
};

/**
 * Création d’une demande — intention déjà fingerprintée.
 * Horloge et expiration injectées — jamais Date.now() implicite.
 * Pas de ToolDefinition, pas d’arguments métier complets.
 */
export type ApprovalRequestInput = {
  tenant_id: string;
  request_fingerprint: string;
  params_hash: string;
  tool_id: string;
  tool_version: string;
  mode: AgentMode;
  requested_autonomy_level: AutonomyLevel;
  resource?: ApprovalResource;
  requester_actor: ApprovalActor;
  /** Instant ISO-8601 UTC injecté. */
  now: string;
  /** Expiration absolue ISO-8601 — prioritaire sur ttl_seconds. */
  expires_at?: string;
  /** TTL relatif (secondes) si expires_at absent. */
  ttl_seconds?: number;
};

export type ApprovalRequestResult = {
  approval_id: string;
  status: "pending";
  requested_at: string;
  expires_at: string;
};

export type ApprovalDecisionInput = {
  approval_id: string;
  tenant_id: string;
  decision: ApprovalDecision;
  decided_by_actor_id: string;
  reason_code: string;
  /** Instant ISO-8601 UTC injecté. */
  now: string;
};

export type ApprovalDecisionResult = {
  approval_id: string;
  status: "approved" | "rejected";
  decided_at: string;
  decision: ApprovalDecision;
};

export type ApprovalInspectionInput = {
  approval_id: string;
  tenant_id: string;
  /** Instant ISO-8601 UTC injecté — overlay d’expiration logique. */
  now: string;
};

/**
 * Inspection de confiance — source pour HumanValidationRecord (G1-C).
 * Ne constitue pas une preuve si fournie par l’appelant sans inspect().
 */
export type ApprovalInspectionFound = {
  found: true;
  approval_id: string;
  tenant_id: string;
  status: ApprovalStatus;
  request_fingerprint: string;
  params_hash: string;
  tool_id: string;
  tool_version: string;
  mode: AgentMode;
  requested_autonomy_level: AutonomyLevel;
  resource?: ApprovalResource;
  requested_at: string;
  expires_at: string;
  decided_at?: string;
  decided_by_actor_id?: string;
  decision_reason_code?: string;
  consumed_at?: string;
  consumed_by_correlation_id?: string;
  /** true si status logique expired alors que la ligne était encore pending/approved. */
  logically_expired?: boolean;
};

export type ApprovalInspectionMissing = {
  found: false;
  code: "APPROVAL_NOT_FOUND" | "APPROVAL_UNAVAILABLE";
};

export type ApprovalInspectionResult =
  | ApprovalInspectionFound
  | ApprovalInspectionMissing;

export type ApprovalConsumptionInput = {
  approval_id: string;
  tenant_id: string;
  request_fingerprint: string;
  params_hash: string;
  tool_id: string;
  tool_version: string;
  mode: AgentMode;
  requested_autonomy_level: AutonomyLevel;
  resource?: ApprovalResource;
  correlation_id: string;
  /** Hash de la clé d’idempotence — jamais la clé brute. */
  idempotency_key_hash: string;
  /** Instant ISO-8601 UTC injecté. */
  now: string;
};

export type ApprovalConsumptionConsumed = {
  outcome: "consumed";
  approval_id: string;
  status: "consumed";
  consumed_at: string;
};

export type ApprovalConsumptionBlocked = {
  outcome: Exclude<ApprovalSqlConsumeResult, "consumed">;
  code: ApprovalErrorCode;
  approval_id?: string;
  status?: ApprovalStatus;
};

export type ApprovalConsumptionResult =
  | ApprovalConsumptionConsumed
  | ApprovalConsumptionBlocked;

/**
 * Contrat public G1-H — injecté dans le Router / orchestrateur de confiance.
 * Le Permission Service reste pur : il reçoit un HumanValidationRecord dérivé
 * de `inspect()`, jamais une preuve déclarative arbitraire de l’appelant.
 */
export type HumanApprovalService = {
  request(input: ApprovalRequestInput): Promise<ApprovalRequestResult>;
  decide(input: ApprovalDecisionInput): Promise<ApprovalDecisionResult>;
  inspect(input: ApprovalInspectionInput): Promise<ApprovalInspectionResult>;
  consume(input: ApprovalConsumptionInput): Promise<ApprovalConsumptionResult>;
};

/** Noms RPC — migration parallèle G1-H. */
export const APPROVAL_RPC = {
  create: "create_human_approval",
  decide: "decide_human_approval",
  consume: "consume_human_approval",
  status: "get_human_approval_status",
} as const;

export const AGENT_HUMAN_APPROVALS_TABLE = "agent_human_approvals" as const;

/** TTL par défaut (1 h) si seul ttl_seconds est fourni côté appelant. */
export const APPROVAL_DEFAULT_TTL_SECONDS = 3600;
/** Aligné sur `create_human_approval` (migration G1-H) — min 60. */
export const APPROVAL_MIN_TTL_SECONDS = 60;
/** Max 7 jours — aligné migration G1-H (604800). */
export const APPROVAL_MAX_TTL_SECONDS = 604_800;
