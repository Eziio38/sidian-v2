/**
 * G1-N — service runtime + wire unique vers protection.draft.* (G1-M).
 *
 * Le LLM n’écrit jamais en base. Confirm / RPC / communications client : hors périmètre.
 */

import { createHash } from "node:crypto";

import type {
  ProtectionDraftService,
} from "@/lib/agent/protection-draft";
import { isProtectionDraftError } from "@/lib/agent/protection-draft";

import { applyUserCorrection } from "./corrections";
import { ConversationalRuntimeError } from "./errors";
import { parseUserMessage } from "./parse";
import { generateSummary } from "./domain";
import type {
  ConversationalRuntimeService,
  ConversationalTurnInput,
  ConversationalTurnResult,
  LlmProvider,
  ParseUserMessageInput,
  ParseUserMessageResult,
} from "./types";

type CacheEntry = {
  result: ConversationalTurnResult;
  expires_at_ms: number;
  /** Tenant propriétaire de l'entrée — revérifié à chaque lecture du cache. */
  tenant_id: string;
};

/**
 * Empreinte du cache d'idempotence.
 *
 * `tenant_id` est TOUJOURS dans la clé, y compris lorsque l'appelant fournit
 * son propre `idempotency_key`. Ce dernier vient du corps de la requête : il
 * est choisi par le client, donc deux tenants peuvent parfaitement envoyer la
 * même valeur. Le tenant provient lui du TrustedExecutionContext et n'est
 * jamais influençable depuis la requête.
 *
 * Les composants sont préfixés par leur longueur pour qu'aucune combinaison de
 * valeurs ne puisse produire la même chaîne qu'une autre.
 */
function turnFingerprint(input: ConversationalTurnInput): string {
  const scoped =
    input.idempotency_key !== undefined && input.idempotency_key !== null
      ? ["k", input.tenant_id, input.idempotency_key]
      : [
          "d",
          input.tenant_id,
          input.draft_id ?? "",
          input.conversation_id ?? "",
          input.user_message,
          input.reference_now,
        ];

  const key = scoped.map((part) => `${part.length}:${part}`).join("|");
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export type CreateConversationalRuntimeOptions = {
  provider: LlmProvider;
  draftService: ProtectionDraftService;
  /** TTL cache idempotence runtime (ms). */
  idempotencyTtlMs?: number;
};

export function createConversationalRuntimeService(
  options: CreateConversationalRuntimeOptions,
): ConversationalRuntimeService {
  const cache = new Map<string, CacheEntry>();
  const ttl = options.idempotencyTtlMs ?? 10 * 60 * 1000;

  function purge(nowMs: number) {
    for (const [k, v] of cache) {
      if (v.expires_at_ms <= nowMs) cache.delete(k);
    }
  }

  return {
    async parseUserMessage(
      input: ParseUserMessageInput,
    ): Promise<ParseUserMessageResult> {
      return parseUserMessage(options.provider, input);
    },

    async handleTurn(
      input: ConversationalTurnInput,
    ): Promise<ConversationalTurnResult> {
      // tenant/actor uniquement depuis TrustedExecutionContext (passés ici).
      if (!input.tenant_id || !input.actor_id) {
        throw new ConversationalRuntimeError(
          "CONVERSATIONAL_TENANT_FORBIDDEN",
          { message: "trusted_identity_required" },
        );
      }

      const nowMs = Date.now();
      purge(nowMs);
      const fp = turnFingerprint(input);
      const cached = cache.get(fp);
      // Deuxième barrière : même si l'empreinte venait à être mal construite,
      // une entrée appartenant à un autre tenant n'est jamais servie.
      if (
        cached &&
        cached.expires_at_ms > nowMs &&
        cached.tenant_id === input.tenant_id
      ) {
        return { ...cached.result, replay: true };
      }

      // 1) LLM → schéma → domaine
      const parsed = await parseUserMessage(options.provider, {
        user_message: input.user_message,
        reference_now: input.reference_now,
        timeout_ms: input.timeout_ms,
        max_retries: input.max_retries,
        correlation_id: input.correlation_id,
      });

      // 2) Wire unique : protection.draft via intent interne apply_extraction
      let advanced;
      try {
        advanced = await options.draftService.advance({
          tenant_id: input.tenant_id,
          actor_id: input.actor_id,
          draft_id: input.draft_id,
          conversation_id: input.conversation_id,
          intent: {
            kind: "apply_extraction",
            fields: parsed.extraction.fields,
            ambiguities: parsed.extraction.ambiguities,
          },
          now: input.reference_now,
        });
      } catch (err) {
        if (isProtectionDraftError(err)) {
          throw new ConversationalRuntimeError(
            err.code === "PROTECTION_DRAFT_TENANT_MISMATCH"
              ? "CONVERSATIONAL_TENANT_FORBIDDEN"
              : "CONVERSATIONAL_INTERNAL_ERROR",
            {
              message: err.code,
              userMessage: err.userMessage,
              category:
                err.code === "PROTECTION_DRAFT_TENANT_MISMATCH"
                  ? "permission"
                  : "technical",
            },
          );
        }
        throw err;
      }

      const result: ConversationalTurnResult = {
        draft: advanced.draft,
        recap: advanced.recap,
        targeted_question: advanced.targeted_question,
        summary: generateSummary({
          ...parsed.extraction,
          fields: advanced.draft.fields,
          missing_fields: advanced.draft.missing_fields,
          ambiguities: advanced.draft.open_ambiguities,
        }),
        extraction: {
          ...parsed.extraction,
          fields: advanced.draft.fields,
          missing_fields: advanced.draft.missing_fields,
          ambiguities: advanced.draft.open_ambiguities,
        },
        trace: parsed.trace,
        replay: false,
      };

      cache.set(fp, {
        result,
        expires_at_ms: nowMs + ttl,
        tenant_id: input.tenant_id,
      });
      return result;
    },
  };
}

export { applyUserCorrection };
