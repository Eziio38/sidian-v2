/**
 * Codes d’erreur de persistance audit (G1-F).
 * Messages applicatifs stables — jamais de SQL brut ni de stack.
 */

export const AUDIT_PERSISTENCE_ERROR_CODES = [
  "AUDIT_EVENT_INVALID",
  "AUDIT_PERSISTENCE_UNAVAILABLE",
  "AUDIT_PERSISTENCE_REJECTED",
  "AUDIT_PERSISTENCE_CONFLICT",
  "AUDIT_PERSISTENCE_FAILED",
] as const;

export type AuditPersistenceErrorCode =
  (typeof AUDIT_PERSISTENCE_ERROR_CODES)[number];

/** Messages sûrs exposables — aucun détail PostgREST / SQL. */
export const AUDIT_PERSISTENCE_SAFE_MESSAGES = {
  AUDIT_EVENT_INVALID:
    "Événement d’audit invalide ou champs interdits (schéma strict).",
  AUDIT_PERSISTENCE_UNAVAILABLE:
    "Service de persistance d’audit indisponible.",
  AUDIT_PERSISTENCE_REJECTED:
    "Persistance d’audit rejetée par la base (contrainte ou politique).",
  AUDIT_PERSISTENCE_CONFLICT:
    "Conflit de persistance d’audit (audit_id déjà présent).",
  AUDIT_PERSISTENCE_FAILED:
    "Échec de persistance d’audit.",
} as const satisfies Record<AuditPersistenceErrorCode, string>;

export class AuditPersistenceError extends Error {
  readonly code: AuditPersistenceErrorCode;

  constructor(code: AuditPersistenceErrorCode, message?: string) {
    super(message ?? AUDIT_PERSISTENCE_SAFE_MESSAGES[code]);
    this.name = "AuditPersistenceError";
    this.code = code;
  }
}
