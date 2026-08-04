/**
 * Types de persistance append-only des AuditEvent (G1-F).
 * Alignés sur la table `agent_audit_events` (migration parallèle).
 */

import type { AuditEvent } from "@/lib/agent/audit/types";

import type { AuditPersistenceErrorCode } from "./errors";

/** Version de schéma embarquée dans chaque ligne (colonne + payload). */
export const AUDIT_EVENT_SCHEMA_VERSION = "1" as const;

export const AGENT_AUDIT_EVENTS_TABLE = "agent_audit_events" as const;

/**
 * Ligne d’insertion — mapping explicite AuditEvent → SQL.
 * `recorded_at` est géré par la base (default now()) — jamais fourni ici.
 *
 * Note : `audit_id` est text (`aud_…`), pas uuid — contrat G1-E réel.
 */
export type AgentAuditEventInsert = {
  audit_id: string;
  schema_version: typeof AUDIT_EVENT_SCHEMA_VERSION;
  occurred_at: string;
  correlation_id: string;
  tenant_id: string;
  actor_id: string;
  actor_type: string;
  tool_id: string | null;
  tool_version: string | null;
  mode: string | null;
  requested_autonomy_level: number | null;
  decision: string;
  result_status: string;
  reason_code: string;
  resource_kind: string | null;
  resource_id: string | null;
  params_hash: string | null;
  output_hash: string | null;
  executor_id: string | null;
  /** AuditEvent G1-E sanitizé (schéma strict) — jamais payload métier brut. */
  event_payload: AuditEvent;
};

export type AuditAppendSuccess = {
  ok: true;
  audit_id: string;
};

export type AuditAppendFailure = {
  ok: false;
  code: AuditPersistenceErrorCode;
  /** Message sûr — jamais SQL / stack / détail PostgREST. */
  message: string;
};

export type AuditAppendResult = AuditAppendSuccess | AuditAppendFailure;

/**
 * Surface minimale du client Supabase pour l’append-only.
 * Injectée — aucune création implicite de client global.
 */
export type AuditPersistencePostgrestError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

export type AuditPersistenceInsertBuilder = {
  insert(
    values: AgentAuditEventInsert,
  ): PromiseLike<{
    error: AuditPersistencePostgrestError | null;
    data?: unknown;
    status?: number;
    statusText?: string;
  }>;
};

export type AuditPersistenceClient = {
  from(relation: typeof AGENT_AUDIT_EVENTS_TABLE): AuditPersistenceInsertBuilder;
};
