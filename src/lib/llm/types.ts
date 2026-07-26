/**
 * Types du runtime LLM P0 — indépendants du domaine métier.
 */

import type { LlmAllowedPurpose, LlmForbiddenIntent } from "./safety";

export type LlmTransportMode = "disabled" | "stub" | "live";

export type LlmMessageRole = "system" | "user" | "assistant";

export type LlmMessage = {
  role: LlmMessageRole;
  content: string;
};

export type LlmCompletionRequest = {
  purpose: LlmAllowedPurpose;
  messages: LlmMessage[];
  /**
   * Intentions métier explicitement demandées par l’appelant.
   * Toute intention interdite → refus fail-closed avant réseau.
   */
  intents?: LlmForbiddenIntent[];
  /**
   * Noms d’outils que l’appelant voudrait exposer.
   * Tout nom financier → refus. Le provider live n’envoie jamais de tools.
   */
  tool_names?: string[];
  /** Max tokens de sortie (borné par env). */
  max_output_tokens?: number;
  /** Température (0..1) — plafonnée. */
  temperature?: number;
  /** Force une sortie JSON (OpenAI-compatible json_object). */
  json_mode?: boolean;
  /** Timeout HTTP ms (sinon env). */
  timeout_ms?: number;
  /** Retries additionnels (sinon env). */
  max_retries?: number;
  /** Scope budget — opaque (ex. tenant_id hashé côté appelant). */
  budget_scope_key?: string;
  correlation_id?: string;
  signal?: AbortSignal;
};

export type LlmTokenUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type LlmCompletionResult = {
  provider_id: string;
  mode: LlmTransportMode;
  content: string;
  usage?: LlmTokenUsage;
  duration_ms: number;
  attempt: number;
  /** Empreinte messages (sha256 tronquée) — pas le texte. */
  input_fingerprint: string;
};

/**
 * Transport bas niveau (stub | live HTTP).
 * Aucune logique métier / permission.
 */
export type LlmTransport = {
  readonly provider_id: string;
  readonly mode: Exclude<LlmTransportMode, "disabled">;
  complete(input: {
    messages: LlmMessage[];
    max_output_tokens: number;
    temperature: number;
    json_mode: boolean;
    timeout_ms: number;
    signal?: AbortSignal;
  }): Promise<{
    content: string;
    usage?: LlmTokenUsage;
  }>;
};

/**
 * Runtime LLM : garde-fous + budget + retries + observabilité + transport.
 */
export type LlmRuntime = {
  readonly provider_id: string;
  readonly mode: LlmTransportMode;
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
};

export type LlmObservabilityEvent = {
  event_id: string;
  recorded_at: string;
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
  budget_scope_key_fingerprint?: string;
  correlation_id?: string;
};

export type LlmObservabilitySink = {
  record(event: LlmObservabilityEvent): Promise<void>;
};
