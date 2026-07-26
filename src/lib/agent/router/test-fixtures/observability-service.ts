/**
 * Spy ObservabilityService / sink pour tests Router (G1-I).
 * Zéro I/O réseau — InMemory / échecs normalisés uniquement.
 */

import {
  createObservabilityService,
  type ObservabilityEvent,
  type ObservabilityRecordResult,
  type ObservabilityService,
  type ObservabilitySink,
  type ObservabilitySinkResult,
} from "@/lib/agent/observability";

export type SpyObservabilitySink = ObservabilitySink & {
  events: ObservabilityEvent[];
  callCount: () => number;
  recordCount: () => number;
  pendingCount: () => number;
  reset: () => void;
};

export type SpyObservabilitySinkOptions = {
  result?:
    | ObservabilitySinkResult
    | ((event: ObservabilityEvent) => ObservabilitySinkResult);
  throwOnRecord?: boolean | Error | (() => Error);
  delayMs?: number;
};

export function createSpyObservabilitySink(
  options: SpyObservabilitySinkOptions = {},
): SpyObservabilitySink {
  const events: ObservabilityEvent[] = [];
  let calls = 0;
  let pending = 0;

  return {
    events,
    callCount: () => calls,
    recordCount: () => events.length,
    pendingCount: () => pending,
    reset() {
      events.length = 0;
      calls = 0;
      pending = 0;
    },
    async record(event: ObservabilityEvent): Promise<ObservabilitySinkResult> {
      calls += 1;
      pending += 1;
      try {
        if (options.delayMs && options.delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, options.delayMs));
        }
        if (options.throwOnRecord) {
          if (typeof options.throwOnRecord === "function") {
            throw options.throwOnRecord();
          }
          if (options.throwOnRecord instanceof Error) {
            throw options.throwOnRecord;
          }
          throw new Error(
            "obs sink boom with stack\n    at Object.record\ntoken=sk_live_test",
          );
        }
        const result =
          typeof options.result === "function"
            ? options.result(event)
            : (options.result ?? {
                ok: true as const,
                event_id: event.event_id,
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

export type SpyObservabilityService = ObservabilityService & {
  sink: SpyObservabilitySink;
  recordCalls: unknown[];
  recordCount: () => number;
  /** Ordre relatif avec audit : timestamps pushés à chaque record(). */
  timeline: Array<"obs_record_start" | "obs_record_end">;
};

export type SpyObservabilityServiceOptions = {
  sink?: SpyObservabilitySink | SpyObservabilitySinkOptions | false;
  /**
   * Si true, `record` throw avant le service réel
   * (simule plantage total best-effort).
   */
  throwOnRecord?: boolean | Error | (() => Error);
};

/**
 * Service réel branché sur un sink spy (défaut succès).
 * Compte les appels `record` pour assertions d’intégration Router.
 */
export function createSpyObservabilityService(
  options: SpyObservabilityServiceOptions = {},
): SpyObservabilityService {
  const sink =
    options.sink === false
      ? createSpyObservabilitySink({
          result: {
            ok: false,
            code: "SINK_UNAVAILABLE",
            message: "Sink d’observabilité indisponible.",
          },
        })
      : options.sink && "record" in options.sink
        ? options.sink
        : createSpyObservabilitySink(
            typeof options.sink === "object" ? options.sink : {},
          );

  const inner = createObservabilityService({ sink });
  const recordCalls: unknown[] = [];
  const timeline: Array<"obs_record_start" | "obs_record_end"> = [];

  const service: SpyObservabilityService = {
    sink,
    recordCalls,
    timeline,
    recordCount: () => recordCalls.length,
    async record(input: unknown): Promise<ObservabilityRecordResult> {
      timeline.push("obs_record_start");
      recordCalls.push(input);
      try {
        if (options.throwOnRecord) {
          if (typeof options.throwOnRecord === "function") {
            throw options.throwOnRecord();
          }
          if (options.throwOnRecord instanceof Error) {
            throw options.throwOnRecord;
          }
          throw new Error("obs service boom\n    at Object.record");
        }
        return await inner.record(input);
      } finally {
        timeline.push("obs_record_end");
      }
    },
  };

  return service;
}
