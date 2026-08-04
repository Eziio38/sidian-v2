/**
 * Transport stub — aucun réseau.
 */

import type { LlmTransport } from "../types";

export type StubLlmTransportOptions = {
  /** Contenu fixe renvoyé (sinon JSON minimal). */
  content?: string | ((messages: unknown) => string);
  /** Simule une erreur. */
  error?: Error;
  /** Délai avant réponse (ms) — pour tests timeout. */
  delay_ms?: number;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export function createStubLlmTransport(
  options: StubLlmTransportOptions = {},
): LlmTransport {
  return {
    provider_id: "stub:llm",
    mode: "stub",
    async complete(input) {
      if (options.delay_ms && options.delay_ms > 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, options.delay_ms);
          input.signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
            },
            { once: true },
          );
        });
      }
      if (input.signal?.aborted) {
        throw Object.assign(new Error("Aborted"), { name: "AbortError" });
      }
      if (options.error) {
        throw options.error;
      }
      const content =
        typeof options.content === "function"
          ? options.content(input.messages)
          : (options.content ??
            JSON.stringify({
              schema_version: "conversational.extraction.v1",
              fields: {},
              ambiguities: [],
            }));
      return {
        content,
        usage: options.usage ?? {
          prompt_tokens: 10,
          completion_tokens: 10,
          total_tokens: 20,
        },
      };
    },
  };
}
