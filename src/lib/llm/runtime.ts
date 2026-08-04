/**
 * Runtime LLM : safety → budget → retries → transport → observabilité.
 */

import { createLlmBudgetTracker, type LlmBudgetTracker } from "./budget";
import { isLlmError, LlmError } from "./errors";
import {
  buildLlmObservabilityEvent,
  fingerprintMessages,
  type InMemoryLlmObservabilitySink,
} from "./observability";
import { sanitizeUserContentForModel } from "./redaction";
import {
  findForbiddenToolNames,
  isAllowedPurpose,
  isForbiddenIntent,
} from "./safety";
import type {
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmObservabilitySink,
  LlmRuntime,
  LlmTransport,
  LlmTransportMode,
} from "./types";

export type CreateLlmRuntimeOptions = {
  transport: LlmTransport;
  mode: LlmTransportMode;
  maxRetries: number;
  httpTimeoutMs: number;
  maxOutputTokens: number;
  budget: LlmBudgetTracker;
  observability: LlmObservabilitySink;
};

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === "AbortError") ||
    (typeof DOMException !== "undefined" &&
      err instanceof DOMException &&
      err.name === "AbortError")
  );
}

async function withTimeout<T>(
  timeoutMs: number,
  parent: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  parent?.addEventListener("abort", onParentAbort, { once: true });
  if (parent?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", onParentAbort);
  }
}

function sanitizeMessages(
  messages: LlmCompletionRequest["messages"],
): LlmCompletionRequest["messages"] {
  return messages.map((m) => ({
    role: m.role,
    content:
      m.role === "user"
        ? sanitizeUserContentForModel(m.content)
        : m.content.slice(0, 16_000),
  }));
}

/**
 * Construit le runtime avec garde-fous obligatoires.
 */
export function createLlmRuntime(options: CreateLlmRuntimeOptions): LlmRuntime {
  const provider_id = options.transport.provider_id;

  return {
    provider_id,
    mode: options.mode,

    async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
      const started = Date.now();
      const input_fingerprint = fingerprintMessages(request.messages);
      let attempt = 0;

      const fail = async (error: LlmError): Promise<never> => {
        await options.observability.record(
          buildLlmObservabilityEvent({
            purpose: isAllowedPurpose(request.purpose)
              ? request.purpose
              : "text_generation",
            provider_id,
            mode: options.mode,
            ok: false,
            duration_ms: Date.now() - started,
            attempt: Math.max(attempt, 1),
            input_fingerprint,
            error_code: error.code,
            budget_scope_key: request.budget_scope_key,
            correlation_id: request.correlation_id,
          }),
        );
        throw error;
      };

      if (options.mode === "disabled") {
        return fail(
          new LlmError("LLM_DISABLED", { message: "llm_provider_disabled" }),
        );
      }

      if (!isAllowedPurpose(request.purpose)) {
        return fail(
          new LlmError("LLM_PURPOSE_FORBIDDEN", {
            message: "llm_purpose_not_allowed",
          }),
        );
      }

      for (const intent of request.intents ?? []) {
        if (isForbiddenIntent(intent)) {
          return fail(
            new LlmError("LLM_PURPOSE_FORBIDDEN", {
              message: `llm_intent_forbidden:${intent}`,
            }),
          );
        }
      }

      const forbiddenTools = findForbiddenToolNames(request.tool_names ?? []);
      if (forbiddenTools.length > 0) {
        return fail(
          new LlmError("LLM_PURPOSE_FORBIDDEN", {
            message: "llm_financial_tools_forbidden",
          }),
        );
      }
      if ((request.tool_names?.length ?? 0) > 0) {
        // Même outils « sûrs » : P0 n’expose aucun tool-calling au modèle.
        return fail(
          new LlmError("LLM_PURPOSE_FORBIDDEN", {
            message: "llm_tools_not_supported",
          }),
        );
      }

      try {
        options.budget.consume({
          scope_key: request.budget_scope_key,
          estimated_tokens: 200,
        });
      } catch (err) {
        if (isLlmError(err)) return fail(err);
        throw err;
      }

      const messages = sanitizeMessages(request.messages);
      const timeout_ms = request.timeout_ms ?? options.httpTimeoutMs;
      const max_retries = request.max_retries ?? options.maxRetries;
      const attemptsAllowed = 1 + Math.max(0, max_retries);
      const max_output_tokens = Math.min(
        request.max_output_tokens ?? options.maxOutputTokens,
        options.maxOutputTokens,
      );
      const temperature = Math.min(
        Math.max(request.temperature ?? 0, 0),
        1,
      );

      let lastError: LlmError | null = null;

      while (attempt < attemptsAllowed) {
        attempt += 1;
        try {
          const result = await withTimeout(
            timeout_ms,
            request.signal,
            (signal) =>
              options.transport.complete({
                messages,
                max_output_tokens,
                temperature,
                json_mode: request.json_mode ?? false,
                timeout_ms,
                signal,
              }),
          );

          if (result.usage) {
            options.budget.recordUsage({
              scope_key: request.budget_scope_key,
              tokens: result.usage.total_tokens,
            });
          }

          const completion: LlmCompletionResult = {
            provider_id,
            mode: options.mode,
            content: result.content,
            usage: result.usage,
            duration_ms: Date.now() - started,
            attempt,
            input_fingerprint,
          };

          await options.observability.record(
            buildLlmObservabilityEvent({
              purpose: request.purpose,
              provider_id,
              mode: options.mode,
              ok: true,
              duration_ms: completion.duration_ms,
              attempt,
              input_fingerprint,
              prompt_tokens: result.usage?.prompt_tokens,
              completion_tokens: result.usage?.completion_tokens,
              total_tokens: result.usage?.total_tokens,
              budget_scope_key: request.budget_scope_key,
              correlation_id: request.correlation_id,
            }),
          );

          return completion;
        } catch (err) {
          if (isAbortError(err)) {
            lastError = new LlmError("LLM_TIMEOUT", { message: "llm_timeout" });
          } else if (isLlmError(err)) {
            lastError = err;
          } else {
            lastError = new LlmError("LLM_PROVIDER_ERROR", {
              message: "llm_provider_error",
              cause: err,
            });
          }
          if (!lastError.retryable || attempt >= attemptsAllowed) {
            break;
          }
        }
      }

      const finalError =
        lastError ??
        new LlmError("LLM_RETRY_EXHAUSTED", { message: "llm_retry_exhausted" });
      // Plusieurs tentatives épuisées → code agrégé ; sinon conserver la cause (ex. timeout).
      if (
        attempt > 1 &&
        finalError.retryable &&
        finalError.code !== "LLM_RETRY_EXHAUSTED"
      ) {
        return fail(
          new LlmError("LLM_RETRY_EXHAUSTED", {
            message: finalError.message,
            cause: finalError,
          }),
        );
      }
      return fail(finalError);
    },
  };
}

export type { LlmBudgetTracker, InMemoryLlmObservabilitySink };
