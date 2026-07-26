/**
 * Budget temps soft — laisse une marge avant maxDuration Vercel.
 */

export type Deadline = {
  readonly startedAtMs: number;
  readonly deadlineAtMs: number;
  remainingMs(): number;
  isExpired(): boolean;
};

export function createDeadline(budgetMs: number, nowMs = Date.now()): Deadline {
  const startedAtMs = nowMs;
  const deadlineAtMs = startedAtMs + Math.max(1_000, budgetMs);
  return {
    startedAtMs,
    deadlineAtMs,
    remainingMs() {
      return Math.max(0, deadlineAtMs - Date.now());
    },
    isExpired() {
      return Date.now() >= deadlineAtMs;
    },
  };
}

/** Défaut : 50s sur une fonction maxDuration 60s. */
export const DEFAULT_CRON_BUDGET_MS = 50_000;
