/**
 * Spy AuditSink mémoire pour tests Router (G1-F).
 * Zéro I/O — append en mémoire uniquement.
 */

import type { AuditEvent } from "@/lib/agent/audit";
import type {
  AuditAppendResult,
  AuditSink,
} from "@/lib/agent/audit/persistence";

export type SpyAuditSink = AuditSink & {
  events: AuditEvent[];
  /** Tentatives d’append (succès ou échec). */
  callCount: () => number;
  /** Appends réussis (= events.length). */
  appendCount: () => number;
  /** Promesses d’append encore en vol (pour assertions d’await). */
  pendingCount: () => number;
  reset: () => void;
};

export type SpyAuditSinkOptions = {
  /** Résultat forcé — défaut succès. */
  result?: AuditAppendResult | ((event: AuditEvent) => AuditAppendResult);
  /** Si true, append rejette (exception) — Router doit fail-closed. */
  throwOnAppend?: boolean | Error | (() => Error);
  /** Délai artificiel (ms) pour vérifier l’await avant fin de route(). */
  delayMs?: number;
};

export function createSpyAuditSink(
  options: SpyAuditSinkOptions = {},
): SpyAuditSink {
  const events: AuditEvent[] = [];
  let calls = 0;
  let pending = 0;

  return {
    events,
    callCount: () => calls,
    appendCount: () => events.length,
    pendingCount: () => pending,
    reset() {
      events.length = 0;
      calls = 0;
      pending = 0;
    },
    async append(event: AuditEvent): Promise<AuditAppendResult> {
      calls += 1;
      pending += 1;
      try {
        if (options.delayMs && options.delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, options.delayMs));
        }
        if (options.throwOnAppend) {
          if (typeof options.throwOnAppend === "function") {
            throw options.throwOnAppend();
          }
          if (options.throwOnAppend instanceof Error) {
            throw options.throwOnAppend;
          }
          throw new Error("sink boom with stack\n    at Object.append");
        }
        const result =
          typeof options.result === "function"
            ? options.result(event)
            : (options.result ?? {
                ok: true as const,
                audit_id: event.audit_id,
              });
        if (result.ok) {
          events.push(event);
        }
        return result;
      } finally {
        pending -= 1;
      }
    },
  };
}
