/**
 * Persistance append-only des AuditEvent (G1-F) — exports publics.
 * Aucune I/O implicite : le client Supabase est injecté à la création.
 */

export {
  AUDIT_PERSISTENCE_ERROR_CODES,
  AUDIT_PERSISTENCE_SAFE_MESSAGES,
  AuditPersistenceError,
} from "./errors";
export type { AuditPersistenceErrorCode } from "./errors";

export {
  AUDIT_EVENT_SCHEMA_VERSION,
  AGENT_AUDIT_EVENTS_TABLE,
} from "./types";
export type {
  AgentAuditEventInsert,
  AuditAppendSuccess,
  AuditAppendFailure,
  AuditAppendResult,
  AuditPersistenceClient,
  AuditPersistenceInsertBuilder,
  AuditPersistencePostgrestError,
} from "./types";

export type { AuditEventRepository, AuditSink } from "./repository";
export { asAuditSink } from "./repository";

export { mapAuditEventToInsert, toEventPayload } from "./mapping";

export {
  createSupabaseAuditRepository,
  classifyPersistenceError,
} from "./supabase-audit-repository";
