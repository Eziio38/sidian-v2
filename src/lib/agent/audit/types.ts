/**
 * Types de l’Audit Service déterministe (G1-E).
 * Construction pure d’événements — aucune persistance, aucune I/O.
 * Alias alignés sur les contrats G1-C (permissions) / G1-D (router).
 */

import type {
  ActorType,
  AgentMode,
  AutonomyLevel,
  PermissionResource,
  ResourceKind,
} from "@/lib/agent/permissions/types";

import type { AuditBuildErrorCode, AuditReasonCode } from "./reason-codes";

export type {
  ActorType,
  AgentMode,
  AutonomyLevel,
  ResourceKind,
};

/** Alias G1-C — ressource scopée tenant. */
export type AuditResource = PermissionResource;

export type AuditActor = {
  actor_id: string;
  actor_type: ActorType;
};

export type AuditTenant = {
  tenant_id: string;
};

export type AuditToolRef = {
  /** Null si l’outil n’a pas pu être résolu (échec précoce). */
  tool_id: string | null;
  tool_version: string | null;
};

export type AuditAutonomy = {
  requested: AutonomyLevel | null;
  maximum: AutonomyLevel | null;
};

/**
 * Décision de permission au moment de l’audit.
 * `none` = permission non évaluée (échec validation / registry avant authorize).
 */
export type AuditDecisionOutcome =
  | "allow"
  | "deny"
  | "require_approval"
  | "none";

/**
 * Issue terminale de l’appel d’outil (alignée Router + Permission).
 */
export type AuditResultKind =
  | "success"
  | "denied"
  | "approval_required"
  | "validation_error"
  | "technical_error"
  | "business_error";

/**
 * Issue d’exécution côté Router / Idempotency (G1-G).
 * `indeterminate` = effet possible mais finalisation idempotente échouée.
 */
export type AuditExecutionOutcome =
  | "not_started"
  | "executed"
  | "replayed"
  | "indeterminate";

/**
 * Statut d’idempotence observé au moment de l’audit (sanitizé).
 * Aligné sur les décisions claim + issues complete/fail.
 */
export type AuditIdempotencyStatus =
  | "acquired"
  | "replay_success"
  | "replay_failure"
  | "conflict"
  | "in_progress"
  | "unavailable"
  | "completed"
  | "failed"
  | "completion_failed";

/**
 * Événement d’audit tool-call — structure minimale G1-E (+ pont G1-G).
 * Interdit : payload complet, secrets, tokens, PAN, stack traces.
 * Clé d’idempotence brute : préférer `idempotency_key_hash` (Router G1-G).
 */
export type AuditEvent = {
  audit_id: string;
  /** ISO-8601 UTC injecté via contexte — jamais d’horloge implicite. */
  timestamp: string;
  correlation_id: string;
  tenant: AuditTenant;
  actor: AuditActor;
  tool: AuditToolRef;
  mode: AgentMode | null;
  autonomy: AuditAutonomy;
  decision: AuditDecisionOutcome;
  result: AuditResultKind;
  reason_code: AuditReasonCode;
  /** Durée mesurée par l’appelant (ms), jamais chronométrée ici. */
  duration_ms: number;
  resource?: AuditResource;
  /** Empreinte des paramètres — jamais le payload. */
  params_hash: string | null;
  /** Identifiant d’exécuteur si invoqué ; null sinon. */
  executor: string | null;
  /** Empreinte de la sortie validée — absente si pas de sortie. */
  output_hash?: string;
  /** Identifiant de validation humaine liée, le cas échéant. */
  human_validation_id?: string;
  /**
   * Clé d’idempotence en clair — **legacy / fixtures uniquement**.
   * Le Router G1-G émet `idempotency_key_hash` à la place.
   */
  idempotency_key?: string;
  /** Empreinte SHA-256 hex de la clé — jamais la clé brute si sensible. */
  idempotency_key_hash?: string;
  /** Décision / statut idempotence observé (sanitizé). */
  idempotency_status?: AuditIdempotencyStatus;
  /** true si l’issue est un rejeu (pas de nouvel effet exécuteur). */
  replayed?: boolean;
  /** Empreinte d’intention claimée (fingerprint G1-G). */
  request_fingerprint?: string;
  /** Degré d’exécution observé (G1-G). */
  execution_outcome?: AuditExecutionOutcome;
  /** Identifiant d’approbation humaine (G1-H) — jamais commentaire libre. */
  approval_id?: string;
  /** Statut d’approbation observé (sanitizé). */
  approval_status?: string;
  /** true si la définition exigeait une validation humaine. */
  approval_required?: boolean;
  /** true si consume atomique a réussi sur ce chemin. */
  approval_consumed?: boolean;
  /** Décision humaine observée (approve/reject) si connue. */
  approval_decision?: string;
  /** Code d’échec d’approbation sanitizé (pas de message libre). */
  approval_failure_code?: string;
};

/**
 * Entrée de construction — fournie par le Router (ou tests).
 * Pas de champs payload / arguments / secret / stack.
 */
export type AuditBuildInput = {
  /** Si omis, dérivé déterministe des champs stables. */
  audit_id?: string;
  correlation_id: string;
  tenant: AuditTenant;
  actor: AuditActor;
  tool: AuditToolRef;
  mode: AgentMode | null;
  autonomy: AuditAutonomy;
  decision: AuditDecisionOutcome;
  result: AuditResultKind;
  reason_code: AuditReasonCode;
  duration_ms: number;
  resource?: AuditResource;
  params_hash?: string | null;
  executor?: string | null;
  output_hash?: string;
  human_validation_id?: string;
  idempotency_key?: string;
  idempotency_key_hash?: string;
  idempotency_status?: AuditIdempotencyStatus;
  replayed?: boolean;
  request_fingerprint?: string;
  execution_outcome?: AuditExecutionOutcome;
  approval_id?: string;
  approval_status?: string;
  approval_required?: boolean;
  approval_consumed?: boolean;
  approval_decision?: string;
  approval_failure_code?: string;
};

/** Contexte de construction — horloge injectée obligatoire. */
export type AuditBuildContext = {
  now: string;
};

export type AuditService = {
  /**
   * Construit un AuditEvent pur et déterministe.
   * Aucun effet de bord (pas de DB, log, réseau, horloge globale).
   */
  build(input: unknown, context: unknown): AuditEvent;
};

export class AuditBuildError extends Error {
  readonly code: AuditBuildErrorCode;

  constructor(code: AuditBuildErrorCode, message: string) {
    super(message);
    this.name = "AuditBuildError";
    this.code = code;
  }
}
