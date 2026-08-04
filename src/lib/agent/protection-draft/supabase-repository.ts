/**
 * G1-M — repository Supabase (RPC service_role uniquement).
 */

import { ProtectionDraftError } from "./errors";
import type {
  ConfirmDraftParams,
  ConfirmDraftResult,
  ProtectionDraftRepository,
  UpsertDraftParams,
} from "./repository";
import type {
  AttachmentMeta,
  DraftFieldName,
  DraftFields,
  OpenAmbiguity,
  ProtectionDraftRecord,
  ProtectionDraftState,
} from "./types";

export type ProtectionDraftPostgrestError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

export type ProtectionDraftRpcResult = {
  data: unknown;
  error: ProtectionDraftPostgrestError | null;
};

export type ProtectionDraftPersistenceClient = {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<ProtectionDraftRpcResult>;
};

const RPC = {
  upsert: "upsert_agent_protection_draft",
  get: "get_agent_protection_draft",
  cancel: "cancel_agent_protection_draft",
  confirm: "confirm_agent_protection_draft",
} as const;

function mapSqlError(message: string | undefined): ProtectionDraftError {
  const m = message ?? "";
  if (m.includes("protection_draft_not_found")) {
    return new ProtectionDraftError("PROTECTION_DRAFT_NOT_FOUND");
  }
  if (m.includes("protection_draft_expired")) {
    return new ProtectionDraftError("PROTECTION_DRAFT_EXPIRED");
  }
  if (m.includes("protection_draft_confirmation_required")) {
    return new ProtectionDraftError("PROTECTION_DRAFT_CONFIRMATION_REQUIRED");
  }
  if (m.includes("protection_draft_confirmation_mismatch")) {
    return new ProtectionDraftError("PROTECTION_DRAFT_CONFIRMATION_MISMATCH");
  }
  if (m.includes("protection_draft_missing_fields")) {
    return new ProtectionDraftError("PROTECTION_DRAFT_MISSING_FIELDS");
  }
  if (m.includes("protection_draft_ambiguities_open")) {
    return new ProtectionDraftError("PROTECTION_DRAFT_AMBIGUITIES_OPEN");
  }
  if (m.includes("protection_draft_not_ready")) {
    return new ProtectionDraftError("PROTECTION_DRAFT_NOT_READY");
  }
  if (m.includes("protection_draft_not_confirmable")) {
    return new ProtectionDraftError("PROTECTION_DRAFT_NOT_CONFIRMABLE");
  }
  if (m.includes("idempotency_payload_conflict")) {
    return new ProtectionDraftError("PROTECTION_DRAFT_IDEMPOTENCY_CONFLICT");
  }
  if (m.includes("protection_draft_input_invalid")) {
    return new ProtectionDraftError("PROTECTION_DRAFT_INPUT_INVALID");
  }
  return new ProtectionDraftError("PROTECTION_DRAFT_UNAVAILABLE", {
    category: "technical",
  });
}

function asRecord(row: unknown): ProtectionDraftRecord {
  if (!row || typeof row !== "object") {
    throw new ProtectionDraftError("PROTECTION_DRAFT_UNAVAILABLE", {
      category: "technical",
    });
  }
  const r = row as Record<string, unknown>;
  return {
    draft_id: String(r.draft_id),
    tenant_id: String(r.tenant_id),
    actor_id: String(r.actor_id),
    conversation_id:
      r.conversation_id === null || r.conversation_id === undefined
        ? null
        : String(r.conversation_id),
    state: r.state as ProtectionDraftState,
    fields: (r.fields ?? {}) as DraftFields,
    missing_fields: (r.missing_fields ?? []) as DraftFieldName[],
    pending_question:
      r.pending_question === null || r.pending_question === undefined
        ? null
        : String(r.pending_question),
    open_ambiguities: (r.open_ambiguities ?? []) as OpenAmbiguity[],
    attachments: (r.attachments ?? []) as AttachmentMeta[],
    client_creation_key:
      r.client_creation_key === null || r.client_creation_key === undefined
        ? null
        : String(r.client_creation_key),
    creance_creation_key:
      r.creance_creation_key === null || r.creance_creation_key === undefined
        ? null
        : String(r.creance_creation_key),
    confirmation_nonce:
      r.confirmation_nonce === null || r.confirmation_nonce === undefined
        ? null
        : String(r.confirmation_nonce),
    confirmed_at:
      r.confirmed_at === null || r.confirmed_at === undefined
        ? null
        : String(r.confirmed_at),
    client_payeur_id:
      r.client_payeur_id === null || r.client_payeur_id === undefined
        ? null
        : String(r.client_payeur_id),
    creance_id:
      r.creance_id === null || r.creance_id === undefined
        ? null
        : String(r.creance_id),
    expires_at: String(r.expires_at),
    cancelled_at:
      r.cancelled_at === null || r.cancelled_at === undefined
        ? null
        : String(r.cancelled_at),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

export function createSupabaseProtectionDraftRepository(
  client: ProtectionDraftPersistenceClient,
): ProtectionDraftRepository {
  return {
    async upsert(params: UpsertDraftParams) {
      const { data, error } = await client.rpc(RPC.upsert, {
        p_tenant_id: params.tenant_id,
        p_actor_id: params.actor_id,
        p_draft_id: params.draft_id ?? null,
        p_conversation_id: params.conversation_id ?? null,
        p_state: params.state,
        p_fields: params.fields,
        p_missing_fields: params.missing_fields,
        p_pending_question: params.pending_question,
        p_open_ambiguities: params.open_ambiguities,
        p_attachments: params.attachments,
        p_client_creation_key: params.client_creation_key ?? null,
        p_creance_creation_key: params.creance_creation_key ?? null,
        p_confirmation_nonce: params.confirmation_nonce ?? null,
        p_expires_at: params.expires_at,
        p_now: params.now,
      });
      if (error) throw mapSqlError(error.message);
      return asRecord(data);
    },

    async get(params) {
      const { data, error } = await client.rpc(RPC.get, {
        p_tenant_id: params.tenant_id,
        p_draft_id: params.draft_id,
        p_now: params.now,
      });
      if (error) throw mapSqlError(error.message);
      return asRecord(data);
    },

    async cancel(params) {
      const { data, error } = await client.rpc(RPC.cancel, {
        p_tenant_id: params.tenant_id,
        p_actor_id: params.actor_id,
        p_draft_id: params.draft_id,
        p_now: params.now,
      });
      if (error) throw mapSqlError(error.message);
      return asRecord(data);
    },

    async confirm(params: ConfirmDraftParams): Promise<ConfirmDraftResult> {
      const { data, error } = await client.rpc(RPC.confirm, {
        p_tenant_id: params.tenant_id,
        p_actor_id: params.actor_id,
        p_draft_id: params.draft_id,
        p_confirmation_nonce: params.confirmation_nonce,
        p_now: params.now,
      });
      if (error) throw mapSqlError(error.message);
      if (!data || typeof data !== "object") {
        throw new ProtectionDraftError("PROTECTION_DRAFT_UNAVAILABLE", {
          category: "technical",
        });
      }
      const r = data as Record<string, unknown>;
      return {
        outcome: r.outcome === "replay" ? "replay" : "created",
        draft_id: String(r.draft_id),
        state: r.state as ConfirmDraftResult["state"],
        client_payeur_id: String(r.client_payeur_id),
        creance_id: String(r.creance_id),
      };
    },
  };
}
