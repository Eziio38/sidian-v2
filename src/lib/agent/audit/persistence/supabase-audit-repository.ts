/**
 * Repository Supabase append-only pour AuditEvent (G1-F).
 * Client injecté — une seule tentative d’insert — zéro update/delete.
 *
 * G1-K trust boundary : le client est typiquement **service_role** (bypass RLS
 * PostgREST). Le `tenant_id` écrit dans la ligne **doit** provenir exclusivement
 * du TrustedExecutionContext (Router/Gateway) — jamais d’un body appelant.
 * Ce repository ne re-valide pas la membership ; la confiance est dans
 * l’orchestrateur qui construit l’AuditEvent.
 */

import { auditEventSchema } from "@/lib/agent/audit/schemas";
import type { AuditEvent } from "@/lib/agent/audit/types";

import {
  AUDIT_PERSISTENCE_SAFE_MESSAGES,
  type AuditPersistenceErrorCode,
} from "./errors";
import { mapAuditEventToInsert } from "./mapping";
import type { AuditEventRepository } from "./repository";
import {
  AGENT_AUDIT_EVENTS_TABLE,
  type AuditAppendFailure,
  type AuditAppendResult,
  type AuditPersistenceClient,
  type AuditPersistencePostgrestError,
} from "./types";

function failure(code: AuditPersistenceErrorCode): AuditAppendFailure {
  return {
    ok: false,
    code,
    message: AUDIT_PERSISTENCE_SAFE_MESSAGES[code],
  };
}

/**
 * Classe une erreur PostgREST/Postgres sans exposer message/détails SQL.
 * Duplication `audit_id` → CONFLICT (23505).
 */
export function classifyPersistenceError(
  error: AuditPersistencePostgrestError | null | undefined,
): AuditPersistenceErrorCode {
  const code = error?.code?.trim() ?? "";

  if (code === "23505") {
    return "AUDIT_PERSISTENCE_CONFLICT";
  }

  // Connexion / indisponibilité
  if (
    code === "PGRST301" ||
    code === "08000" ||
    code === "08001" ||
    code === "08003" ||
    code === "08006" ||
    code === "57P01" ||
    code === "57P02" ||
    code === "57P03"
  ) {
    return "AUDIT_PERSISTENCE_UNAVAILABLE";
  }

  // Contrainte, privilège, RLS, check, FK, type
  if (
    code === "42501" ||
    code === "23514" ||
    code === "23503" ||
    code === "23502" ||
    code === "22P02" ||
    code === "PGRST204" ||
    code === "PGRST116"
  ) {
    return "AUDIT_PERSISTENCE_REJECTED";
  }

  return "AUDIT_PERSISTENCE_FAILED";
}

function isTransportFailure(err: unknown): boolean {
  if (err === null || err === undefined) {
    return false;
  }
  if (typeof err !== "object") {
    return true;
  }
  const name = "name" in err ? String(err.name) : "";
  return (
    name === "AbortError" ||
    name === "FetchError" ||
    name === "TypeError" ||
    name === "TimeoutError"
  );
}

/**
 * Crée le repository de production.
 * @param client Client Supabase (ou surface compatible) **injecté**.
 */
export function createSupabaseAuditRepository(
  client: AuditPersistenceClient,
): AuditEventRepository {
  return {
    async append(event: AuditEvent): Promise<AuditAppendResult> {
      const parsed = auditEventSchema.safeParse(event);
      if (!parsed.success) {
        return failure("AUDIT_EVENT_INVALID");
      }

      const row = mapAuditEventToInsert(parsed.data);

      try {
        const { error } = await client
          .from(AGENT_AUDIT_EVENTS_TABLE)
          .insert(row);

        if (error) {
          return failure(classifyPersistenceError(error));
        }

        return { ok: true, audit_id: row.audit_id };
      } catch (err) {
        if (isTransportFailure(err)) {
          return failure("AUDIT_PERSISTENCE_UNAVAILABLE");
        }
        return failure("AUDIT_PERSISTENCE_FAILED");
      }
    },
  };
}
