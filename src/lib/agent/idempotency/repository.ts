/**
 * Contrat repository d’idempotence (G1-G).
 * Le Router dépend de `IdempotencyService`, pas de ce repository ni de Supabase.
 * Aligné sur RPC migration `20260724230000_g1g_agent_idempotency.sql`.
 */

import type {
  AgentMode,
  IdempotencyResource,
  IdempotencySqlClaimDecision,
  IdempotencyTerminalResult,
} from "./types";

export type IdempotencyRepositoryClaimParams = {
  tenant_id: string;
  idempotency_key: string;
  correlation_id: string;
  tool_id: string;
  tool_version: string;
  mode: AgentMode;
  resource_kind: string | null;
  resource_id: string | null;
  request_fingerprint: string;
  owner_token_hash: string;
  now: string;
  ttl_seconds: number;
};

/**
 * Résultat brut repository (libellés SQL).
 * Le service mappe vers les décisions API (`replay_success`, `acquired`, …).
 */
export type IdempotencyRepositoryClaimResult = {
  sql_decision: IdempotencySqlClaimDecision;
  record_id: string | null;
  expires_at: string | null;
  terminal_result: IdempotencyTerminalResult | null;
  terminal_result_hash: string | null;
  failure_code: string | null;
};

export type IdempotencyRepositoryCompleteParams = {
  record_id: string;
  owner_token_hash: string;
  terminal_result: IdempotencyTerminalResult;
  terminal_result_hash: string;
  /** → `p_completed_at` */
  now: string;
};

export type IdempotencyRepositoryFailParams = {
  record_id: string;
  owner_token_hash: string;
  failure_code: string;
  terminal_result: IdempotencyTerminalResult;
  terminal_result_hash: string;
  now: string;
};

export type IdempotencyRepository = {
  claim(
    params: IdempotencyRepositoryClaimParams,
  ): Promise<IdempotencyRepositoryClaimResult>;
  complete(params: IdempotencyRepositoryCompleteParams): Promise<void>;
  fail(params: IdempotencyRepositoryFailParams): Promise<void>;
};

/** Helper — extrait kind/id ressource pour les params RPC. */
export function resourceColumns(
  resource: IdempotencyResource | undefined,
): { resource_kind: string | null; resource_id: string | null } {
  if (!resource) {
    return { resource_kind: null, resource_id: null };
  }
  return {
    resource_kind: resource.kind,
    resource_id: resource.resource_id,
  };
}
