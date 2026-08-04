/**
 * Types du service d’idempotence persistant (G1-G).
 * Alignés sur G1-C (permissions), G1-D (router) et G1-E/F (audit).
 * Aucun client Supabase global — injection via repository.
 */

import type {
  AgentMode,
  AutonomyLevel,
  PermissionResource,
} from "@/lib/agent/permissions/types";

import type { IdempotencyErrorCode } from "./errors";

export type { AgentMode, AutonomyLevel, IdempotencyErrorCode };
export type IdempotencyResource = PermissionResource;

/** Statuts persistés en base (migration parallèle). */
export const IDEMPOTENCY_RECORD_STATUSES = [
  "in_progress",
  "succeeded",
  "failed",
] as const;

export type IdempotencyRecordStatus =
  (typeof IDEMPOTENCY_RECORD_STATUSES)[number];

/**
 * Décisions applicatives du claim (API service).
 * Distinctes des libellés SQL (`replay_succeeded`, `expired_reacquired`, …)
 * — mapping dans le repository.
 */
export const IDEMPOTENCY_CLAIM_DECISIONS = [
  "acquired",
  "replay_success",
  "replay_failure",
  "conflict",
  "in_progress",
  "unavailable",
] as const;

export type IdempotencyClaimDecisionKind =
  (typeof IDEMPOTENCY_CLAIM_DECISIONS)[number];

/**
 * Décisions brutes renvoyées par `claim_idempotency_key` (RPC SQL).
 */
export const IDEMPOTENCY_SQL_CLAIM_DECISIONS = [
  "acquired",
  "replay_succeeded",
  "replay_failed",
  "conflict",
  "in_progress",
  "expired_reacquired",
] as const;

export type IdempotencySqlClaimDecision =
  (typeof IDEMPOTENCY_SQL_CLAIM_DECISIONS)[number];

/** Résultat terminal succès — sanitizé (jamais payload métier brut). */
export type IdempotencyTerminalSuccess = {
  status: "success";
  /** Empreinte de la sortie validée — obligatoire. */
  output_hash: string;
  /**
   * Résumé non sensible déjà rédigé par l’appelant (Router).
   * Interdit : secrets, stack, tokens, arguments complets.
   */
  summary?: Record<string, string | number | boolean | null>;
};

/** Résultat terminal échec — sanitizé. */
export type IdempotencyTerminalFailure = {
  status: "failure";
  failure_code: string;
  /** Message sûr — jamais stack ni détail SQL. */
  message?: string;
};

export type IdempotencyTerminalResult =
  | IdempotencyTerminalSuccess
  | IdempotencyTerminalFailure;

/**
 * Source d’empreinte — intention validée (post args + authorize).
 * Pas de timestamp, pas de correlation_id, pas de secrets.
 */
export type IdempotencyFingerprintSource = {
  tenant_id: string;
  tool_id: string;
  tool_version: string;
  mode: AgentMode;
  requested_autonomy_level: AutonomyLevel;
  resource?: IdempotencyResource;
  /** Arguments déjà validés par schéma outil — canonicalisés ensuite. */
  arguments: unknown;
  /** Hash des paramètres courants (lié validation humaine). */
  current_params_hash?: string;
  /** Identifiant de validation humaine — jamais le token brut. */
  human_validation_id?: string;
};

export type IdempotencyClaimInput = {
  tenant_id: string;
  idempotency_key: string;
  correlation_id: string;
  tool_id: string;
  tool_version: string;
  mode: AgentMode;
  resource?: IdempotencyResource;
  request_fingerprint: string;
  /** Instant ISO-8601 UTC injecté — jamais d’horloge implicite. */
  now: string;
  /** Durée de lease in_progress (secondes). */
  ttl_seconds: number;
};

export type IdempotencyCompleteInput = {
  /** Identifiant du record acquis au claim — clé RPC `p_record_id`. */
  record_id: string;
  /** Jeton propriétaire brut reçu au claim acquired — hashé avant RPC. */
  owner_token: string;
  terminal_result: IdempotencyTerminalResult;
  /** Instant ISO-8601 UTC injecté → `p_completed_at`. */
  now: string;
};

export type IdempotencyFailInput = {
  record_id: string;
  owner_token: string;
  failure_code: string;
  terminal_result?: IdempotencyTerminalResult;
  now: string;
};

export type IdempotencyClaimAcquired = {
  decision: "acquired";
  /** Jeton propriétaire à présenter à complete/fail — jamais loggé / persisté brut. */
  owner_token: string;
  record_id: string;
  expires_at: string;
  /** true si reprise atomique après expiration (SQL `expired_reacquired`). */
  reacquired?: boolean;
};

export type IdempotencyClaimReplaySuccess = {
  decision: "replay_success";
  record_id?: string;
  terminal_result: IdempotencyTerminalResult;
  terminal_result_hash?: string;
};

export type IdempotencyClaimReplayFailure = {
  decision: "replay_failure";
  record_id?: string;
  terminal_result: IdempotencyTerminalResult;
  failure_code?: string;
  terminal_result_hash?: string;
  code: "IDEMPOTENCY_REPLAY_FAILURE";
};

export type IdempotencyClaimConflict = {
  decision: "conflict";
  code: "IDEMPOTENCY_KEY_CONFLICT";
};

export type IdempotencyClaimInProgress = {
  decision: "in_progress";
  code: "IDEMPOTENCY_IN_PROGRESS";
  expires_at?: string;
};

export type IdempotencyClaimUnavailable = {
  decision: "unavailable";
  code: "IDEMPOTENCY_UNAVAILABLE";
};

export type IdempotencyClaimDecision =
  | IdempotencyClaimAcquired
  | IdempotencyClaimReplaySuccess
  | IdempotencyClaimReplayFailure
  | IdempotencyClaimConflict
  | IdempotencyClaimInProgress
  | IdempotencyClaimUnavailable;

/**
 * Contrat public G1-G — injecté dans le Router (pas de couplage Supabase).
 */
export type IdempotencyService = {
  claim(input: IdempotencyClaimInput): Promise<IdempotencyClaimDecision>;
  complete(input: IdempotencyCompleteInput): Promise<void>;
  fail(input: IdempotencyFailInput): Promise<void>;
};

/** Noms RPC — migration parallèle G1-G. */
export const IDEMPOTENCY_RPC = {
  claim: "claim_idempotency_key",
  complete: "complete_idempotency_record",
  fail: "fail_idempotency_record",
} as const;

export const AGENT_IDEMPOTENCY_RECORDS_TABLE =
  "agent_idempotency_records" as const;

/** TTL par défaut aligné sur les leases checkout du dépôt (secondes). */
export const IDEMPOTENCY_DEFAULT_TTL_SECONDS = 120;

export const IDEMPOTENCY_MIN_TTL_SECONDS = 15;
/** Aligné sur `claim_idempotency_key` (migration G1-G) — max 3600. */
export const IDEMPOTENCY_MAX_TTL_SECONDS = 3600;
