/**
 * G1-M — repository mémoire (tests unitaires, pas de DB).
 * Simule isolation tenant + création atomique idempotente.
 */

import { randomUUID } from "node:crypto";

import { ProtectionDraftError } from "../errors";
import type {
  ConfirmDraftParams,
  ConfirmDraftResult,
  ProtectionDraftRepository,
  UpsertDraftParams,
} from "../repository";
import type { ProtectionDraftRecord } from "../types";

type Stored = ProtectionDraftRecord & {
  /** Snapshot payload pour conflit d’idempotence. */
  create_fingerprint?: string;
};

function fingerprintFromFields(fields: ProtectionDraftRecord["fields"]): string {
  return JSON.stringify({
    n: fields.client_name?.value,
    e: fields.client_email?.value,
    a: fields.expected_amount_minor?.value,
    c: fields.currency?.value,
    d: fields.due_date?.value,
  });
}

export function createMemoryProtectionDraftRepository(): ProtectionDraftRepository & {
  _store: Map<string, Stored>;
  _clients: Map<string, { id: string; tenant_id: string; key: string }>;
  _creances: Map<string, { id: string; tenant_id: string; key: string; client_id: string }>;
} {
  const store = new Map<string, Stored>();
  const clients = new Map<string, { id: string; tenant_id: string; key: string }>();
  const creances = new Map<
    string,
    { id: string; tenant_id: string; key: string; client_id: string }
  >();

  function requireTenantDraft(
    tenantId: string,
    draftId: string,
  ): Stored {
    const row = store.get(draftId);
    if (!row || row.tenant_id !== tenantId) {
      throw new ProtectionDraftError("PROTECTION_DRAFT_NOT_FOUND");
    }
    return row;
  }

  function maybeExpire(row: Stored, now: string): Stored {
    if (
      row.state !== "TERMINE" &&
      row.state !== "ANNULE" &&
      row.state !== "EXPIRE" &&
      row.expires_at < now
    ) {
      const updated = { ...row, state: "EXPIRE" as const, updated_at: now };
      store.set(row.draft_id, updated);
      return updated;
    }
    return row;
  }

  return {
    _store: store,
    _clients: clients,
    _creances: creances,

    async upsert(params: UpsertDraftParams): Promise<ProtectionDraftRecord> {
      if (params.draft_id) {
        const existing = requireTenantDraft(params.tenant_id, params.draft_id);
        const updated: Stored = {
          ...existing,
          conversation_id:
            params.conversation_id !== undefined
              ? params.conversation_id
              : existing.conversation_id,
          state: params.state,
          fields: params.fields,
          missing_fields: params.missing_fields,
          pending_question: params.pending_question,
          open_ambiguities: params.open_ambiguities,
          attachments: params.attachments,
          client_creation_key:
            params.client_creation_key ?? existing.client_creation_key,
          creance_creation_key:
            params.creance_creation_key ?? existing.creance_creation_key,
          confirmation_nonce:
            params.confirmation_nonce ?? existing.confirmation_nonce,
          expires_at: params.expires_at,
          updated_at: params.now,
        };
        store.set(updated.draft_id, updated);
        return { ...updated };
      }

      const draft_id = randomUUID();
      const row: Stored = {
        draft_id,
        tenant_id: params.tenant_id,
        actor_id: params.actor_id,
        conversation_id: params.conversation_id ?? null,
        state: params.state,
        fields: params.fields,
        missing_fields: params.missing_fields,
        pending_question: params.pending_question,
        open_ambiguities: params.open_ambiguities,
        attachments: params.attachments,
        client_creation_key: params.client_creation_key ?? null,
        creance_creation_key: params.creance_creation_key ?? null,
        confirmation_nonce: params.confirmation_nonce ?? null,
        confirmed_at: null,
        client_payeur_id: null,
        creance_id: null,
        expires_at: params.expires_at,
        cancelled_at: null,
        created_at: params.now,
        updated_at: params.now,
      };
      store.set(draft_id, row);
      return { ...row };
    },

    async get(params) {
      const row = maybeExpire(
        requireTenantDraft(params.tenant_id, params.draft_id),
        params.now,
      );
      return { ...row };
    },

    async cancel(params) {
      const row = maybeExpire(
        requireTenantDraft(params.tenant_id, params.draft_id),
        params.now,
      );
      if (row.state === "TERMINE" || row.state === "ANNULE") {
        return { ...row };
      }
      if (row.state === "EXPIRE") {
        return { ...row };
      }
      const updated: Stored = {
        ...row,
        state: "ANNULE",
        cancelled_at: params.now,
        pending_question: null,
        updated_at: params.now,
      };
      store.set(row.draft_id, updated);
      return { ...updated };
    },

    async confirm(params: ConfirmDraftParams): Promise<ConfirmDraftResult> {
      const row = maybeExpire(
        requireTenantDraft(params.tenant_id, params.draft_id),
        params.now,
      );

      if (row.state === "TERMINE" && row.client_payeur_id && row.creance_id) {
        if (row.confirmation_nonce !== params.confirmation_nonce) {
          throw new ProtectionDraftError(
            "PROTECTION_DRAFT_CONFIRMATION_MISMATCH",
          );
        }
        return {
          outcome: "replay",
          draft_id: row.draft_id,
          state: "TERMINE",
          client_payeur_id: row.client_payeur_id,
          creance_id: row.creance_id,
        };
      }

      if (row.state === "ANNULE" || row.state === "EXPIRE") {
        throw new ProtectionDraftError("PROTECTION_DRAFT_NOT_CONFIRMABLE");
      }
      if (row.expires_at < params.now) {
        store.set(row.draft_id, {
          ...row,
          state: "EXPIRE",
          updated_at: params.now,
        });
        throw new ProtectionDraftError("PROTECTION_DRAFT_EXPIRED");
      }
      if (
        row.state !== "RECAPITULATIF" &&
        row.state !== "CONFIRMATION_EXPLICITE" &&
        row.state !== "BROUILLON_COMPLET"
      ) {
        throw new ProtectionDraftError("PROTECTION_DRAFT_NOT_READY");
      }
      if (
        !row.confirmation_nonce ||
        row.confirmation_nonce !== params.confirmation_nonce
      ) {
        throw new ProtectionDraftError(
          "PROTECTION_DRAFT_CONFIRMATION_MISMATCH",
        );
      }
      if (row.missing_fields.length > 0) {
        throw new ProtectionDraftError("PROTECTION_DRAFT_MISSING_FIELDS");
      }
      if (row.open_ambiguities.length > 0) {
        throw new ProtectionDraftError("PROTECTION_DRAFT_AMBIGUITIES_OPEN");
      }

      const clientKey = row.client_creation_key ?? randomUUID();
      const creanceKey = row.creance_creation_key ?? randomUUID();
      const fp = fingerprintFromFields(row.fields);

      const clientMapKey = `${params.tenant_id}:${clientKey}`;
      let client = clients.get(clientMapKey);
      if (!client) {
        client = {
          id: randomUUID(),
          tenant_id: params.tenant_id,
          key: clientKey,
        };
        clients.set(clientMapKey, client);
      }

      const creanceMapKey = `${params.tenant_id}:${creanceKey}`;
      let creance = creances.get(creanceMapKey);
      if (!creance) {
        creance = {
          id: randomUUID(),
          tenant_id: params.tenant_id,
          key: creanceKey,
          client_id: client.id,
        };
        creances.set(creanceMapKey, creance);
      } else if (creance.client_id !== client.id) {
        throw new ProtectionDraftError("PROTECTION_DRAFT_IDEMPOTENCY_CONFLICT");
      }

      const updated: Stored = {
        ...row,
        state: "TERMINE",
        client_creation_key: clientKey,
        creance_creation_key: creanceKey,
        confirmed_at: row.confirmed_at ?? params.now,
        client_payeur_id: client.id,
        creance_id: creance.id,
        pending_question: null,
        updated_at: params.now,
        create_fingerprint: fp,
      };
      store.set(row.draft_id, updated);

      return {
        outcome: "created",
        draft_id: row.draft_id,
        state: "TERMINE",
        client_payeur_id: client.id,
        creance_id: creance.id,
      };
    },
  };
}
