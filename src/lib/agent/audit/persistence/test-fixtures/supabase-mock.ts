/**
 * Mock client Supabase / PostgREST pour tests repository G1-F.
 * Surface minimale : from(table).insert(row) → PromiseLike<{ error }>.
 */

import {
  AGENT_AUDIT_EVENTS_TABLE,
  type AgentAuditEventInsert,
  type AuditPersistenceClient,
  type AuditPersistencePostgrestError,
} from "@/lib/agent/audit/persistence";

export type InsertCall = {
  table: string;
  row: AgentAuditEventInsert;
};

export type MockInsertOutcome =
  | { error: null }
  | { error: AuditPersistencePostgrestError }
  | { throw: unknown };

export type SpyAuditPersistenceClient = AuditPersistenceClient & {
  inserts: InsertCall[];
  insertCount: () => number;
  reset: () => void;
  setNextOutcome: (outcome: MockInsertOutcome) => void;
  /** Compteurs de méthodes non autorisées (ne doivent jamais être appelées). */
  forbiddenCalls: string[];
};

export function createSpyAuditPersistenceClient(
  defaultOutcome: MockInsertOutcome = { error: null },
): SpyAuditPersistenceClient {
  const inserts: InsertCall[] = [];
  const forbiddenCalls: string[] = [];
  let nextOutcome: MockInsertOutcome = defaultOutcome;

  const client: SpyAuditPersistenceClient = {
    inserts,
    forbiddenCalls,
    insertCount: () => inserts.length,
    reset() {
      inserts.length = 0;
      forbiddenCalls.length = 0;
      nextOutcome = defaultOutcome;
    },
    setNextOutcome(outcome) {
      nextOutcome = outcome;
    },
    from(relation) {
      if (relation !== AGENT_AUDIT_EVENTS_TABLE) {
        forbiddenCalls.push(`from:${String(relation)}`);
      }

      return {
        insert(values) {
          inserts.push({ table: relation, row: values });
          const outcome = nextOutcome;
          // Remet le succès par défaut après une issue (une seule tentative).
          nextOutcome = { error: null };

          if ("throw" in outcome) {
            return Promise.reject(outcome.throw);
          }
          return Promise.resolve({ error: outcome.error });
        },
        update(..._args: unknown[]) {
          forbiddenCalls.push("update");
          return Promise.resolve({ error: { message: "forbidden" } });
        },
        delete(..._args: unknown[]) {
          forbiddenCalls.push("delete");
          return Promise.resolve({ error: { message: "forbidden" } });
        },
      } as ReturnType<AuditPersistenceClient["from"]> & {
        update: (...args: unknown[]) => Promise<{ error: unknown }>;
        delete: (...args: unknown[]) => Promise<{ error: unknown }>;
      };
    },
  };

  return client;
}
