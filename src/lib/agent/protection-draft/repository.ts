/**
 * G1-M — contrat repository (I/O injectée).
 */

import type {
  AttachmentMeta,
  DraftFieldName,
  DraftFields,
  OpenAmbiguity,
  ProtectionDraftRecord,
  ProtectionDraftState,
} from "./types";

export type UpsertDraftParams = {
  tenant_id: string;
  actor_id: string;
  draft_id?: string;
  conversation_id?: string | null;
  state: ProtectionDraftState;
  fields: DraftFields;
  missing_fields: DraftFieldName[];
  pending_question: string | null;
  open_ambiguities: OpenAmbiguity[];
  attachments: AttachmentMeta[];
  client_creation_key?: string | null;
  creance_creation_key?: string | null;
  confirmation_nonce?: string | null;
  expires_at: string;
  now: string;
};

export type ConfirmDraftParams = {
  tenant_id: string;
  actor_id: string;
  draft_id: string;
  confirmation_nonce: string;
  now: string;
};

export type ConfirmDraftResult = {
  outcome: "created" | "replay";
  draft_id: string;
  state: ProtectionDraftState;
  client_payeur_id: string;
  creance_id: string;
};

export type ProtectionDraftRepository = {
  upsert(params: UpsertDraftParams): Promise<ProtectionDraftRecord>;
  get(params: {
    tenant_id: string;
    draft_id: string;
    now: string;
  }): Promise<ProtectionDraftRecord>;
  cancel(params: {
    tenant_id: string;
    actor_id: string;
    draft_id: string;
    now: string;
  }): Promise<ProtectionDraftRecord>;
  confirm(params: ConfirmDraftParams): Promise<ConfirmDraftResult>;
};
