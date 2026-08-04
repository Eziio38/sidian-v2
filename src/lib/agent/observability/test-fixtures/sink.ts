/**
 * Sinks de test G1-I — spies / échecs normalisés (zéro réseau).
 */

import type {
  ObservabilityEvent,
  ObservabilitySink,
  ObservabilitySinkResult,
} from "@/lib/agent/observability";

import {
  RAW_SQL_DETAIL,
  SENSITIVE_RAW_TOKEN,
  SENSITIVE_STACK_FRAGMENT,
} from "./constants";

export type SpyObservabilitySink = ObservabilitySink & {
  calls: ObservabilityEvent[];
  recordCallCount: number;
};

/** Sink spy qui enregistre les appels et réussit toujours. */
export function createSpyObservabilitySink(): SpyObservabilitySink {
  const calls: ObservabilityEvent[] = [];
  return {
    calls,
    get recordCallCount() {
      return calls.length;
    },
    async record(event: ObservabilityEvent): Promise<ObservabilitySinkResult> {
      calls.push(event);
      return { ok: true, event_id: event.event_id };
    },
  };
}

/**
 * Sink qui échoue avec une erreur brute (SQL / stack / secret).
 * Le service doit normaliser — jamais propager le détail.
 */
export function createThrowingObservabilitySink(
  detail: string = `${RAW_SQL_DETAIL}\n${SENSITIVE_STACK_FRAGMENT}\ntoken=${SENSITIVE_RAW_TOKEN}`,
): SpyObservabilitySink {
  const calls: ObservabilityEvent[] = [];
  return {
    calls,
    get recordCallCount() {
      return calls.length;
    },
    async record(event: ObservabilityEvent): Promise<ObservabilitySinkResult> {
      calls.push(event);
      throw new Error(detail);
    },
  };
}

/** Sink qui retourne un échec structuré (sans throw). */
export function createFailingResultSink(
  code: "SINK_FAILED" | "SINK_UNAVAILABLE" = "SINK_FAILED",
): SpyObservabilitySink {
  const calls: ObservabilityEvent[] = [];
  return {
    calls,
    get recordCallCount() {
      return calls.length;
    },
    async record(event: ObservabilityEvent): Promise<ObservabilitySinkResult> {
      calls.push(event);
      return {
        ok: false,
        code,
        message:
          code === "SINK_UNAVAILABLE"
            ? "Sink d’observabilité indisponible."
            : "Échec d’enregistrement dans le sink d’observabilité.",
      };
    },
  };
}
