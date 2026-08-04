/**
 * G1-M — exécuteurs Tool Router pour protection drafts.
 * Tenant / actor uniquement depuis ToolExecutorInput (TrustedExecutionContext).
 */

import {
  isProtectionDraftError,
  type ProtectionDraftService,
} from "@/lib/agent/protection-draft";
import type {
  ResolveToolExecutor,
  ToolExecutor,
  ToolExecutorInput,
} from "@/lib/agent/router/executor";
import { ToolExecutorError } from "@/lib/agent/router/executor";

function toExecutorError(err: unknown): ToolExecutorError {
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
    code: "PROTECTION_DRAFT_UNAVAILABLE",
    message: "protection_draft_executor_failed",
    userMessage: "Le brouillon de protection est indisponible.",
  });
}

function advanceOutput(result: Awaited<
  ReturnType<ProtectionDraftService["advance"]>
>) {
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
    attachments_count: result.draft.attachments.length,
  };
}

export function createProtectionDraftExecutors(
  service: ProtectionDraftService,
): ResolveToolExecutor {
  const advanceExecutor: ToolExecutor = {
    async execute(input: ToolExecutorInput) {
      try {
        const args = input.arguments as {
          draft_id?: string;
          conversation_id?: string;
          intent: Parameters<ProtectionDraftService["advance"]>[0]["intent"];
        };
        const result = await service.advance({
          tenant_id: input.tenant.tenant_id,
          actor_id: input.actor.actor_id,
          draft_id: args.draft_id,
          conversation_id: args.conversation_id,
          intent: args.intent,
          now: new Date().toISOString(),
        });
        return advanceOutput(result);
      } catch (err) {
        throw toExecutorError(err);
      }
    },
  };

  const getExecutor: ToolExecutor = {
    async execute(input: ToolExecutorInput) {
      try {
        const args = input.arguments as { draft_id: string };
        const result = await service.get({
          tenant_id: input.tenant.tenant_id,
          draft_id: args.draft_id,
          now: new Date().toISOString(),
        });
        return advanceOutput({
          draft: result.draft,
          recap: result.recap,
          targeted_question: result.draft.pending_question,
        });
      } catch (err) {
        throw toExecutorError(err);
      }
    },
  };

  const cancelExecutor: ToolExecutor = {
    async execute(input: ToolExecutorInput) {
      try {
        const args = input.arguments as { draft_id: string };
        const result = await service.cancel({
          tenant_id: input.tenant.tenant_id,
          actor_id: input.actor.actor_id,
          draft_id: args.draft_id,
          now: new Date().toISOString(),
        });
        return {
          draft_id: result.draft.draft_id,
          state: result.draft.state,
        };
      } catch (err) {
        throw toExecutorError(err);
      }
    },
  };

  const confirmExecutor: ToolExecutor = {
    async execute(input: ToolExecutorInput) {
      try {
        const args = input.arguments as {
          draft_id: string;
          explicit_confirmation: true;
          confirmation_nonce: string;
        };
        const result = await service.confirm({
          tenant_id: input.tenant.tenant_id,
          actor_id: input.actor.actor_id,
          draft_id: args.draft_id,
          explicit_confirmation: true,
          confirmation_nonce: args.confirmation_nonce,
          now: new Date().toISOString(),
        });
        return {
          outcome: result.outcome,
          draft_id: result.draft_id,
          state: "TERMINE" as const,
          client_payeur_id: result.client_payeur_id,
          creance_id: result.creance_id,
        };
      } catch (err) {
        throw toExecutorError(err);
      }
    },
  };

  return (toolId, version) => {
    if (version !== "1.0.0") return undefined;
    switch (toolId) {
      case "protection.draft.advance":
        return advanceExecutor;
      case "protection.draft.get":
        return getExecutor;
      case "protection.draft.cancel":
        return cancelExecutor;
      case "protection.draft.confirm":
        return confirmExecutor;
      default:
        return undefined;
    }
  };
}

export function createProtectionDraftServiceExecutors(
  service: ProtectionDraftService,
): ResolveToolExecutor {
  return createProtectionDraftExecutors(service);
}
