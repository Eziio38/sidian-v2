/**
 * Sinks d’observabilité injectés (G1-I).
 * InMemory + Null uniquement — aucune implémentation réseau/console implicite.
 */

import { observabilityEventSchema } from "./schemas";
import { OBSERVABILITY_SAFE_MESSAGES } from "./reason-codes";
import type {
  ObservabilityEvent,
  ObservabilitySink,
  ObservabilitySinkResult,
} from "./types";

/**
 * Sink mémoire pour tests / harness local.
 * Conserve une copie défensive des événements — zéro I/O.
 */
export class InMemoryObservabilitySink implements ObservabilitySink {
  private readonly _events: ObservabilityEvent[] = [];

  /** Vue lecture seule des événements enregistrés (ordre d’append). */
  get events(): readonly ObservabilityEvent[] {
    return this._events;
  }

  /** Snapshot défensif (copie superficielle des références d’événements). */
  snapshot(): ObservabilityEvent[] {
    return this._events.map((event) => ({ ...event }));
  }

  clear(): void {
    this._events.length = 0;
  }

  async record(event: ObservabilityEvent): Promise<ObservabilitySinkResult> {
    const parsed = observabilityEventSchema.safeParse(event);
    if (!parsed.success) {
      return {
        ok: false,
        code: "OBSERVABILITY_INPUT_INVALID",
        message: OBSERVABILITY_SAFE_MESSAGES.OBSERVABILITY_INPUT_INVALID,
      };
    }

    this._events.push({ ...parsed.data });
    return { ok: true, event_id: parsed.data.event_id };
  }
}

/**
 * Sink explicite no-op — accepte et ignore (tests de best-effort / désactivation).
 * Ne journalise pas, n’envoie pas sur le réseau.
 */
export class NullObservabilitySink implements ObservabilitySink {
  async record(event: ObservabilityEvent): Promise<ObservabilitySinkResult> {
    const parsed = observabilityEventSchema.safeParse(event);
    if (!parsed.success) {
      return {
        ok: false,
        code: "OBSERVABILITY_INPUT_INVALID",
        message: OBSERVABILITY_SAFE_MESSAGES.OBSERVABILITY_INPUT_INVALID,
      };
    }
    return { ok: true, event_id: parsed.data.event_id };
  }
}

/**
 * Indique si un sink mémoire expose un historique utilisable par les détecteurs.
 */
export function isInMemoryObservabilitySink(
  sink: ObservabilitySink,
): sink is InMemoryObservabilitySink {
  return sink instanceof InMemoryObservabilitySink;
}
