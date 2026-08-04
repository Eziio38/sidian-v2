/**
 * Contrats repository / sink de persistance audit (G1-F).
 * Append-only — aucune méthode update / delete.
 */

import type { AuditEvent } from "@/lib/agent/audit/types";

import type { AuditAppendResult } from "./types";

/**
 * Repository de production — insertion unique d’un AuditEvent validé.
 */
export interface AuditEventRepository {
  append(event: AuditEvent): Promise<AuditAppendResult>;
}

/**
 * Sink injecté dans le Router — même contrat que le repository.
 * Le Router ne dépend pas de Supabase : il reçoit un AuditSink.
 */
export interface AuditSink {
  append(event: AuditEvent): Promise<AuditAppendResult>;
}

/** Alias d’intégration — un repository satisfait le sink. */
export function asAuditSink(repository: AuditEventRepository): AuditSink {
  return repository;
}
