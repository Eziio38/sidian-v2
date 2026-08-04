/**
 * G1-N — exécuteurs Tool Router pour protection.draft.converse.
 * Tenant / actor uniquement depuis TrustedExecutionContext.
 * Jamais de confirm / RPC / envoi client depuis ce chemin.
 */

import {
  createConversationalRuntimeService,
  isConversationalRuntimeError,
  type ConversationalRuntimeService,
  type LlmProvider,
} from "@/lib/agent/conversational-runtime";
import type { ProtectionDraftService } from "@/lib/agent/protection-draft";
import { isProtectionDraftError } from "@/lib/agent/protection-draft";
import type {
  ResolveToolExecutor,
  ToolExecutor,
  ToolExecutorInput,
} from "@/lib/agent/router/executor";
import { ToolExecutorError } from "@/lib/agent/router/executor";

function toExecutorError(err: unknown): ToolExecutorError {
  if (isConversationalRuntimeError(err)) {
    const category =
      err.category === "permission" ? "business" : err.category;
    return new ToolExecutorError({
      category,
      code: err.code,
      message: err.message,
      userMessage: err.userMessage,
    });
  }
  if (isProtectionDraftError(err)) {
    return new ToolExecutorError({
      category: err.category,
      code: err.code,
      message: err.message,
      userMessage: err.userMessage,
    });
  }
  return new ToolExecutorError({
    category: "technical",
    code: "CONVERSATIONAL_RUNTIME_UNAVAILABLE",
    message: "conversational_runtime_executor_failed",
    userMessage: "Le runtime conversationnel est indisponible.",
  });
}

export function createConversationalRuntimeExecutors(
  runtime: ConversationalRuntimeService,
): ResolveToolExecutor {
  const converseExecutor: ToolExecutor = {
    async execute(input: ToolExecutorInput) {
      try {
        const args = input.arguments as {
          draft_id?: string;
          conversation_id?: string;
          message: string;
          idempotency_key?: string;
          reference_now?: string;
        };
        const result = await runtime.handleTurn({
          tenant_id: input.tenant.tenant_id,
          actor_id: input.actor.actor_id,
          draft_id: args.draft_id,
          conversation_id: args.conversation_id,
          user_message: args.message,
          idempotency_key: args.idempotency_key,
          reference_now: args.reference_now ?? new Date().toISOString(),
          correlation_id: input.correlation_id,
        });
        return {
          draft_id: result.draft.draft_id,
          state: result.draft.state,
          missing_fields: result.draft.missing_fields,
          pending_question: result.targeted_question,
          open_ambiguities: result.draft.open_ambiguities,
          recap: {
            client_name: result.recap.client_name,
            client_email: result.recap.client_email,
            expected_amount_minor: result.recap.expected_amount_minor,
            currency: result.recap.currency,
            due_date: result.recap.due_date,
            libelle: result.recap.libelle,
            reference_externe: result.recap.reference_externe,
          },
          confirmation_nonce: result.draft.confirmation_nonce,
          summary: result.summary,
          extraction_source: result.extraction.source,
          fallback_used: result.trace.fallback_used,
          replay: result.replay,
          client_payeur_id: null,
          creance_id: null,
        };
      } catch (err) {
        throw toExecutorError(err);
      }
    },
  };

  return (toolId, version) => {
    if (version !== "1.0.0") return undefined;
    if (toolId === "protection.draft.converse") return converseExecutor;
    return undefined;
  };
}

export function createConversationalRuntimeServiceExecutors(input: {
  provider: LlmProvider;
  draftService: ProtectionDraftService;
}): ResolveToolExecutor {
  const runtime = createConversationalRuntimeService({
    provider: input.provider,
    draftService: input.draftService,
  });
  return createConversationalRuntimeExecutors(runtime);
}
