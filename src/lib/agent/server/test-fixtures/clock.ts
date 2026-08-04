/**
 * Horloge injectée contrôlable — timeouts G1-L déterministes.
 */

import type { AgentServerClock } from "@/lib/agent/server";

import { FIXED_NOW } from "./constants";

export type ControllableClock = AgentServerClock & {
  /** Instant courant (ISO). */
  current: string;
  set(iso: string): void;
  advanceMs(ms: number): void;
  reset(iso?: string): void;
};

export function createControllableClock(
  initialIso: string = FIXED_NOW,
): ControllableClock {
  let current = initialIso;

  return {
    get current() {
      return current;
    },
    now() {
      return current;
    },
    set(iso: string) {
      current = iso;
    },
    advanceMs(ms: number) {
      const next = Date.parse(current) + ms;
      current = new Date(next).toISOString();
    },
    reset(iso: string = FIXED_NOW) {
      current = iso;
    },
  };
}
