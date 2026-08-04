/**
 * Audit Service déterministe (G1-E).
 * Fonction pure — aucune I/O, aucune persistance, aucune horloge globale.
 */

import { buildAuditEvent } from "./builder";
import type { AuditEvent, AuditService } from "./types";

/**
 * Crée un Audit Service pur.
 * Le Router G1-D appellera `audit.build()` à chaque issue terminale de `route()`.
 */
export function createAuditService(): AuditService {
  return {
    build(input: unknown, context: unknown): AuditEvent {
      return buildAuditEvent(input, context);
    },
  };
}
