/**
 * Adaptateur G1-N : LlmRuntime → LlmProvider.extract (conversational-runtime).
 *
 * Le modèle propose uniquement une extraction structurée.
 * Jamais de tools financiers ; tenant/actor/confirm hors sortie.
 */

import {
  createStubLlmProvider,
  deterministicToLlmShape,
  type LlmProvider,
  type LlmProviderExtractInput,
  CONVERSATIONAL_RUNTIME_SCHEMA_VERSION,
} from "@/lib/agent/conversational-runtime";

import { isLlmError, LlmError } from "../errors";
import type { LlmRuntime } from "../types";

const EXTRACTION_SYSTEM_PROMPT = `Tu es un extracteur de brouillon de protection pour Sidian.
Tu renvoies UNIQUEMENT un JSON strict avec :
- schema_version: "${CONVERSATIONAL_RUNTIME_SCHEMA_VERSION}"
- fields: client_name, client_email, expected_amount_minor, currency, due_date, libelle, reference_externe
  chaque champ est null ou { "value": string|number, "confidence": 0..1 }
- ambiguities: tableau d'objets { kind: "due_date"|"currency"|"amount", message, candidates? }
- model_notes optionnel (string courte)

Règles absolues :
- N'inclus JAMAIS tenant_id, actor_id, confirm, payment, send, jwt, tokens.
- Les montants sont des propositions de brouillon, PAS une décision de paiement ni un débit.
- N'invente pas de champs absents du message.
- Ne déclenche aucune action financière ni communication client.
- expected_amount_minor est en centimes (entier) si un montant est clair.`;

function parseJsonContent(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    }
    throw new LlmError("LLM_OUTPUT_INVALID", {
      message: "llm_extraction_not_json",
    });
  }
}

export type ConversationalExtractProviderOptions = {
  runtime: LlmRuntime;
  /**
   * Si true (défaut pour mode stub/disabled côté factory assistant),
   * délègue à l’extracteur déterministe G1-M encapsulé.
   */
  preferDeterministicStub?: boolean;
  budget_scope_key?: string;
};

/**
 * Provider compatible G1-N branché sur le runtime LLM P0.
 */
export function createConversationalExtractProvider(
  options: ConversationalExtractProviderOptions,
): LlmProvider {
  if (
    options.preferDeterministicStub ||
    options.runtime.mode === "disabled" ||
    options.runtime.mode === "stub"
  ) {
    // Stub / disabled : zéro réseau — encapsule G1-M déterministe.
    // Le runtime.complete() en disabled refuse les appels ; on n’y passe pas.
    const stub = createStubLlmProvider({ mode: "deterministic" });
    return {
      provider_id: `llm-runtime:${options.runtime.mode}:${stub.provider_id}`,
      extract: (input) => stub.extract(input),
    };
  }

  return {
    provider_id: options.runtime.provider_id,
    async extract(input: LlmProviderExtractInput): Promise<unknown> {
      const known = input.known_fields
        ? `Champs déjà connus (indicatif): ${JSON.stringify(input.known_fields)}`
        : "Aucun champ connu.";
      try {
        const result = await options.runtime.complete({
          purpose: "structured_extraction",
          json_mode: true,
          temperature: 0,
          budget_scope_key: options.budget_scope_key,
          signal: input.signal,
          messages: [
            { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                `Date de référence (AAAA-MM-JJ): ${input.reference_date}`,
                known,
                `Message utilisateur:\n${input.user_message}`,
              ].join("\n\n"),
            },
          ],
        });
        return parseJsonContent(result.content);
      } catch (err) {
        if (isLlmError(err) || (err instanceof Error && err.name === "AbortError")) {
          throw err;
        }
        throw new LlmError("LLM_PROVIDER_ERROR", {
          message: "llm_extract_failed",
          cause: err,
        });
      }
    },
  };
}

/**
 * Fallback déterministe exposé pour tests / documentation.
 */
export function deterministicExtractionShape(
  userMessage: string,
  referenceNowIso: string,
): unknown {
  return deterministicToLlmShape(userMessage, referenceNowIso);
}
