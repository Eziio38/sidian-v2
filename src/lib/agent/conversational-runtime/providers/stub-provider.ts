/**
 * G1-N — provider stub injectable.
 *
 * Utilisé par défaut en tests et CI (aucun appel réseau).
 * Peut être scripté (réponses prédéfinies) ou déléguer à l’extraction déterministe
 * pour produire une sortie conforme au schéma LLM.
 */

import { extractProtectionDraftFromMessage } from "@/lib/agent/protection-draft";

import { CONVERSATIONAL_RUNTIME_SCHEMA_VERSION } from "../types";
import type { LlmProvider, LlmProviderExtractInput } from "../types";

export type StubProviderBehavior =
  | { mode: "deterministic" }
  | { mode: "fixed"; response: unknown }
  | { mode: "sequence"; responses: unknown[] }
  | { mode: "error"; error: Error }
  | { mode: "timeout"; delay_ms: number }
  | {
      mode: "custom";
      handler: (input: LlmProviderExtractInput) => Promise<unknown>;
    };

export type StubLlmProvider = LlmProvider & {
  setBehavior(behavior: StubProviderBehavior): void;
  readonly callCount: number;
};

/**
 * Construit une sortie schéma-conforme à partir de l’extracteur déterministe G1-M.
 */
export function deterministicToLlmShape(
  userMessage: string,
  referenceNowIso: string,
): unknown {
  const extracted = extractProtectionDraftFromMessage(
    userMessage,
    referenceNowIso,
  );
  const fields: Record<string, { value: string | number; confidence: number } | null> =
    {
      client_name: null,
      client_email: null,
      expected_amount_minor: null,
      currency: null,
      due_date: null,
      libelle: null,
      reference_externe: null,
    };

  for (const [key, fv] of Object.entries(extracted.fields)) {
    if (!fv) continue;
    fields[key] = { value: fv.value, confidence: 0.9 };
  }

  return {
    schema_version: CONVERSATIONAL_RUNTIME_SCHEMA_VERSION,
    fields,
    ambiguities: extracted.ambiguities,
  };
}

export function createStubLlmProvider(
  initial: StubProviderBehavior = { mode: "deterministic" },
): StubLlmProvider {
  let behavior = initial;
  let callCount = 0;
  let sequenceIndex = 0;

  const provider: StubLlmProvider = {
    provider_id: "stub:deterministic-or-scripted",
    get callCount() {
      return callCount;
    },
    setBehavior(next) {
      behavior = next;
      sequenceIndex = 0;
    },
    async extract(input) {
      callCount += 1;
      if (behavior.mode === "error") {
        throw behavior.error;
      }
      if (behavior.mode === "timeout") {
        const delayMs = behavior.delay_ms;
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => resolve(), delayMs);
          input.signal?.addEventListener("abort", () => {
            clearTimeout(t);
            reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
          });
        });
        if (input.signal?.aborted) {
          throw Object.assign(new Error("Aborted"), { name: "AbortError" });
        }
        return deterministicToLlmShape(
          input.user_message,
          `${input.reference_date}T12:00:00.000Z`,
        );
      }
      if (behavior.mode === "fixed") {
        return behavior.response;
      }
      if (behavior.mode === "sequence") {
        const item =
          behavior.responses[
            Math.min(sequenceIndex, behavior.responses.length - 1)
          ];
        sequenceIndex += 1;
        return item;
      }
      if (behavior.mode === "custom") {
        return behavior.handler(input);
      }
      return deterministicToLlmShape(
        input.user_message,
        `${input.reference_date}T12:00:00.000Z`,
      );
    },
  };

  return provider;
}
