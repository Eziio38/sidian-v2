/**
 * Budgets / quotas d’usage LLM (process-local, P0).
 * Fail-closed lorsque les plafonds sont atteints.
 */

import { LlmError } from "./errors";

export type LlmBudgetLimits = {
  maxRequestsPerMinute: number;
  maxTokensPerMinute: number;
  maxRequestsPerScopePerHour: number;
};

type WindowCounter = {
  window_start_ms: number;
  count: number;
  tokens: number;
};

export type LlmBudgetTracker = {
  /** Réserve une requête ; lève LLM_BUDGET_EXCEEDED si plafond atteint. */
  consume(input: {
    scope_key?: string;
    estimated_tokens?: number;
  }): void;
  /** Enregistre l’usage réel après succès (tokens). */
  recordUsage(input: { scope_key?: string; tokens: number }): void;
  /** Snapshot tests. */
  snapshot(): {
    global_rpm: number;
    global_tpm: number;
    scopes: number;
  };
  reset(): void;
};

function windowKey(prefix: string, windowMs: number, nowMs: number): string {
  return `${prefix}:${Math.floor(nowMs / windowMs)}`;
}

/**
 * Compteur glissant approximatif par fenêtre fixe (minute / heure).
 * Suffisant pour plafonner un processus Node ; pas un quota distribué.
 */
export function createLlmBudgetTracker(
  limits: LlmBudgetLimits,
  options?: { now?: () => number },
): LlmBudgetTracker {
  const nowFn = options?.now ?? (() => Date.now());
  const minute = new Map<string, WindowCounter>();
  const hour = new Map<string, WindowCounter>();

  function getOrCreate(
    map: Map<string, WindowCounter>,
    key: string,
    nowMs: number,
  ): WindowCounter {
    const existing = map.get(key);
    if (existing) return existing;
    const created: WindowCounter = {
      window_start_ms: nowMs,
      count: 0,
      tokens: 0,
    };
    map.set(key, created);
    // GC opportuniste
    if (map.size > 500) {
      const cutoff = nowMs - 2 * 60 * 60 * 1000;
      for (const [k, v] of map) {
        if (v.window_start_ms < cutoff) map.delete(k);
      }
    }
    return created;
  }

  return {
    consume(input) {
      const nowMs = nowFn();
      const minuteKey = windowKey("g", 60_000, nowMs);
      const globalMinute = getOrCreate(minute, minuteKey, nowMs);

      if (globalMinute.count >= limits.maxRequestsPerMinute) {
        throw new LlmError("LLM_BUDGET_EXCEEDED", {
          message: "llm_rpm_exceeded",
        });
      }
      if (
        globalMinute.tokens + (input.estimated_tokens ?? 0) >
        limits.maxTokensPerMinute
      ) {
        throw new LlmError("LLM_BUDGET_EXCEEDED", {
          message: "llm_tpm_exceeded",
        });
      }

      if (input.scope_key) {
        const hourKey = windowKey(`s:${input.scope_key}`, 3_600_000, nowMs);
        const scopeHour = getOrCreate(hour, hourKey, nowMs);
        if (scopeHour.count >= limits.maxRequestsPerScopePerHour) {
          throw new LlmError("LLM_BUDGET_EXCEEDED", {
            message: "llm_scope_hourly_exceeded",
          });
        }
        scopeHour.count += 1;
      }

      globalMinute.count += 1;
      if (input.estimated_tokens) {
        globalMinute.tokens += input.estimated_tokens;
      }
    },

    recordUsage(input) {
      const nowMs = nowFn();
      const minuteKey = windowKey("g", 60_000, nowMs);
      const globalMinute = getOrCreate(minute, minuteKey, nowMs);
      globalMinute.tokens += Math.max(0, input.tokens);
    },

    snapshot() {
      const nowMs = nowFn();
      const minuteKey = windowKey("g", 60_000, nowMs);
      const global = minute.get(minuteKey);
      return {
        global_rpm: global?.count ?? 0,
        global_tpm: global?.tokens ?? 0,
        scopes: hour.size,
      };
    },

    reset() {
      minute.clear();
      hour.clear();
    },
  };
}
