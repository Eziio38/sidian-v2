/**
 * Client mince protection.draft.* — s’appuie sur callAgentTool (pas de logique métier).
 */

import { callAgentTool, type AgentTransport } from "../agent-client";
import type {
  ProtectionDraftConfirmOutput,
  ProtectionDraftToolOutput,
} from "./types";

export type ProtectionDraftApiError = {
  code: string;
  message: string;
  status: "error" | "blocked" | "pending";
};

export class ProtectionDraftClientError extends Error {
  readonly code: string;
  readonly status: ProtectionDraftApiError["status"];

  constructor(error: ProtectionDraftApiError) {
    super(error.message);
    this.name = "ProtectionDraftClientError";
    this.code = error.code;
    this.status = error.status;
  }
}

type CallOptions = {
  idempotencyKey?: string;
  correlationId?: string;
  signal?: AbortSignal;
  transport?: AgentTransport;
};

function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function callTool<T>(
  toolId: string,
  args: Record<string, unknown>,
  options: CallOptions & {
    mode?: "agir" | "conseiller";
    autonomy?: number;
    requireIdempotency?: boolean;
  } = {},
): Promise<T> {
  const transport = options.transport ?? callAgentTool;
  const result = await transport<T>(
    {
      tool_id: toolId,
      tool_version: "1.0.0",
      mode: options.mode ?? "agir",
      requested_autonomy_level: options.autonomy ?? 1,
      arguments: args,
      ...(options.requireIdempotency || options.idempotencyKey
        ? {
            idempotency_key:
              options.idempotencyKey ?? newId("idem"),
          }
        : {}),
      ...(options.correlationId
        ? { correlation_id: options.correlationId }
        : {}),
    },
    { signal: options.signal },
  );

  if (!result.ok) {
    throw new ProtectionDraftClientError({
      code: result.code,
      message: result.message,
      status: "error",
    });
  }

  return result.output;
}

export type ConverseInput = {
  message: string;
  draftId?: string;
  conversationId?: string;
  idempotencyKey?: string;
  referenceNow?: string;
};

export type AdvanceInput = {
  draftId?: string;
  conversationId?: string;
  intent:
    | { kind: "message"; text: string }
    | { kind: "correction"; field: string; value: string | number }
    | { kind: "answer"; text: string }
    | { kind: "acknowledge_recap" };
};

export type ConfirmInput = {
  draftId: string;
  confirmationNonce: string;
  idempotencyKey?: string;
};

export type CancelInput = { draftId: string };
export type GetInput = { draftId: string };

export const protectionDraftApi = {
  converse(
    input: ConverseInput,
    options?: CallOptions,
  ): Promise<ProtectionDraftToolOutput> {
    return callTool<ProtectionDraftToolOutput>(
      "protection.draft.converse",
      {
        message: input.message,
        ...(input.draftId ? { draft_id: input.draftId } : {}),
        ...(input.conversationId
          ? { conversation_id: input.conversationId }
          : {}),
        ...(input.idempotencyKey
          ? { idempotency_key: input.idempotencyKey }
          : {}),
        ...(input.referenceNow ? { reference_now: input.referenceNow } : {}),
      },
      {
        ...options,
        idempotencyKey: input.idempotencyKey ?? options?.idempotencyKey,
      },
    );
  },

  advance(
    input: AdvanceInput,
    options?: CallOptions,
  ): Promise<ProtectionDraftToolOutput> {
    return callTool<ProtectionDraftToolOutput>(
      "protection.draft.advance",
      {
        ...(input.draftId ? { draft_id: input.draftId } : {}),
        ...(input.conversationId
          ? { conversation_id: input.conversationId }
          : {}),
        intent: input.intent,
      },
      options,
    );
  },

  get(
    input: GetInput,
    options?: CallOptions,
  ): Promise<ProtectionDraftToolOutput> {
    return callTool<ProtectionDraftToolOutput>(
      "protection.draft.get",
      { draft_id: input.draftId },
      { ...options, mode: "conseiller", autonomy: 1 },
    );
  },

  cancel(
    input: CancelInput,
    options?: CallOptions,
  ): Promise<{ draft_id: string; state: string }> {
    return callTool("protection.draft.cancel", {
      draft_id: input.draftId,
    }, options);
  },

  confirm(
    input: ConfirmInput,
    options?: CallOptions,
  ): Promise<ProtectionDraftConfirmOutput> {
    return callTool<ProtectionDraftConfirmOutput>(
      "protection.draft.confirm",
      {
        draft_id: input.draftId,
        explicit_confirmation: true,
        confirmation_nonce: input.confirmationNonce,
      },
      {
        ...options,
        requireIdempotency: true,
        idempotencyKey:
          input.idempotencyKey ??
          options?.idempotencyKey ??
          `confirm-${input.draftId}-${input.confirmationNonce}`,
      },
    );
  },
};
