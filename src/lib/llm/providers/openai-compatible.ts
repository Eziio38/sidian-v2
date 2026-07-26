/**
 * Transport live OpenAI-compatible (chat/completions) via fetch.
 * Aucun SDK — pas d’outils financiers exposés.
 */

import { LlmError } from "../errors";
import type { LlmTransport } from "../types";

export type OpenAiCompatibleTransportConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
};

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === "AbortError") ||
    (typeof DOMException !== "undefined" &&
      err instanceof DOMException &&
      err.name === "AbortError")
  );
}

function classifyHttp(status: number): LlmError {
  if (status === 401 || status === 403) {
    return new LlmError("LLM_PROVIDER_AUTH", {
      message: `llm_http_${status}`,
    });
  }
  if (status === 429) {
    return new LlmError("LLM_PROVIDER_RATE_LIMITED", {
      message: "llm_rate_limited",
    });
  }
  if (status >= 500) {
    return new LlmError("LLM_PROVIDER_ERROR", {
      message: `llm_http_${status}`,
    });
  }
  return new LlmError("LLM_PROVIDER_ERROR", {
    message: `llm_http_${status}`,
  });
}

/**
 * Client HTTP isolé — jamais de `tools` / `functions` dans le payload.
 */
export function createOpenAiCompatibleTransport(
  config: OpenAiCompatibleTransportConfig,
): LlmTransport {
  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    provider_id: `openai-compatible:${config.model}`,
    mode: "live",
    async complete(input) {
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      input.signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), input.timeout_ms);

      try {
        // Interdit : tools, functions, tool_choice — surface financière nulle.
        const body: Record<string, unknown> = {
          model: config.model,
          messages: input.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          max_tokens: input.max_output_tokens,
          temperature: input.temperature,
        };
        if (input.json_mode) {
          body.response_format = { type: "json_object" };
        }

        const response = await fetchImpl(
          `${config.baseUrl}/chat/completions`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          },
        );

        const rawText = await response.text();
        if (!response.ok) {
          throw classifyHttp(response.status);
        }

        let json: unknown;
        try {
          json = JSON.parse(rawText) as unknown;
        } catch {
          throw new LlmError("LLM_OUTPUT_INVALID", {
            message: "llm_non_json_http_body",
          });
        }

        const choice = (
          json as {
            choices?: Array<{ message?: { content?: string | null } }>;
            usage?: {
              prompt_tokens?: number;
              completion_tokens?: number;
              total_tokens?: number;
            };
          }
        )?.choices?.[0];
        const content = choice?.message?.content;
        if (typeof content !== "string" || content.length === 0) {
          throw new LlmError("LLM_OUTPUT_INVALID", {
            message: "llm_empty_content",
          });
        }

        const usageRaw = (json as { usage?: Record<string, number> }).usage;
        const usage =
          usageRaw &&
          typeof usageRaw.prompt_tokens === "number" &&
          typeof usageRaw.completion_tokens === "number"
            ? {
                prompt_tokens: usageRaw.prompt_tokens,
                completion_tokens: usageRaw.completion_tokens,
                total_tokens:
                  typeof usageRaw.total_tokens === "number"
                    ? usageRaw.total_tokens
                    : usageRaw.prompt_tokens + usageRaw.completion_tokens,
              }
            : undefined;

        return { content, usage };
      } catch (err) {
        if (err instanceof LlmError) throw err;
        if (isAbortError(err)) {
          throw new LlmError("LLM_TIMEOUT", { message: "llm_timeout" });
        }
        throw new LlmError("LLM_PROVIDER_ERROR", {
          message: "llm_network_error",
          cause: err,
        });
      } finally {
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}
