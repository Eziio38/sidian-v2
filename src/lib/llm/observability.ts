/**
 * Observabilité LLM — événements sans PII / secrets / prompts bruts.
 */

import { randomUUID } from "node:crypto";

import { createHash } from "node:crypto";

import type {
  LlmObservabilityEvent,
  LlmObservabilitySink,
  LlmTransportMode,
} from "./types";
import type { LlmAllowedPurpose } from "./safety";

export class NullLlmObservabilitySink implements LlmObservabilitySink {
  async record(_event: LlmObservabilityEvent): Promise<void> {
    // no-op — zéro I/O
  }
}

export class InMemoryLlmObservabilitySink implements LlmObservabilitySink {
  private readonly _events: LlmObservabilityEvent[] = [];

  get events(): readonly LlmObservabilityEvent[] {
    return this._events;
  }

  clear(): void {
    this._events.length = 0;
  }

  async record(event: LlmObservabilityEvent): Promise<void> {
    this._events.push({ ...event });
  }
}

export function fingerprintOpaque(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32);
}

export function fingerprintMessages(
  messages: ReadonlyArray<{ role: string; content: string }>,
): string {
  const canonical = messages
    .map((m) => `${m.role}:${m.content.length}:${fingerprintOpaque(m.content)}`)
    .join("|");
  return fingerprintOpaque(canonical);
}

export function buildLlmObservabilityEvent(input: {
  purpose: LlmAllowedPurpose;
  provider_id: string;
  mode: LlmTransportMode;
  ok: boolean;
  duration_ms: number;
  attempt: number;
  input_fingerprint: string;
  error_code?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  budget_scope_key?: string;
  correlation_id?: string;
  now?: () => Date;
}): LlmObservabilityEvent {
  const now = input.now ?? (() => new Date());
  return {
    event_id: randomUUID(),
    recorded_at: now().toISOString(),
    purpose: input.purpose,
    provider_id: input.provider_id,
    mode: input.mode,
    ok: input.ok,
    duration_ms: input.duration_ms,
    attempt: input.attempt,
    input_fingerprint: input.input_fingerprint,
    error_code: input.error_code,
    prompt_tokens: input.prompt_tokens,
    completion_tokens: input.completion_tokens,
    total_tokens: input.total_tokens,
    budget_scope_key_fingerprint: input.budget_scope_key
      ? fingerprintOpaque(input.budget_scope_key)
      : undefined,
    correlation_id: input.correlation_id,
  };
}
