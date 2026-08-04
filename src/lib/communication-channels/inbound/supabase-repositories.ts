/**
 * G1-Q — repositories Supabase (client PostgREST injecté).
 * Mapping snake_case ↔ camelCase. Écriture typiquement service_role.
 */

import type { CommunicationActionKey } from "./actions";
import { createInitialGuidePaymentConfirmation } from "./domain/apply";
import type { GuidePaymentConfirmationRecord } from "./domain/types";
import type {
  GuidePaymentConfirmationRepository,
  InboundMessageRepository,
  InteractionSessionRepository,
} from "./repositories";
import type {
  InboundMessageRecord,
  InteractionSessionRecord,
} from "./types";

// ---------------------------------------------------------------------------
// Client injecté (surface minimale PostgREST, chaînage flexible)
// ---------------------------------------------------------------------------

export type InboundPostgrestError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

export type InboundPostgrestResult = {
  data: unknown;
  error: InboundPostgrestError | null;
};

/**
 * Builder minimal compatible Supabase JS / mocks.
 * from() réel n’expose que select/insert/update ; eq/single viennent après.
 */
export type InboundQueryBuilder = {
  select(columns?: string): InboundQueryBuilder;
  insert(values: Record<string, unknown>): InboundQueryBuilder;
  update(values: Record<string, unknown>): InboundQueryBuilder;
  eq(column: string, value: unknown): InboundQueryBuilder;
  in?(column: string, values: readonly unknown[]): InboundQueryBuilder;
  gt?(column: string, value: unknown): InboundQueryBuilder;
  order?(
    column: string,
    options?: { ascending?: boolean },
  ): InboundQueryBuilder;
  limit?(count: number): InboundQueryBuilder;
  maybeSingle(): PromiseLike<InboundPostgrestResult>;
  single(): PromiseLike<InboundPostgrestResult>;
};

export type InboundRootBuilder = Pick<
  InboundQueryBuilder,
  "select" | "insert" | "update"
>;

export type InboundPersistenceClient = {
  from(relation: string): InboundRootBuilder;
};

/** @deprecated alias — conserver pour imports existants */
export type InboundSupabaseClient = InboundPersistenceClient;
export type PostgrestError = InboundPostgrestError;
export type PostgrestResult<T> = {
  data: T | null;
  error: InboundPostgrestError | null;
};

const TABLES = {
  inbound: "communication_inbound_messages",
  sessions: "communication_interaction_sessions",
  confirmation: "guide_payment_confirmation_state",
} as const;

const CLAIMABLE_STATUSES = [
  "received",
  "validated",
  "correlated",
] as const;

function asInboundQuery(builder: InboundRootBuilder): InboundQueryBuilder {
  return builder as InboundQueryBuilder;
}

function requireClient(client: InboundPersistenceClient): void {
  if (!client || typeof client.from !== "function") {
    throw new Error(
      "inbound_supabase_client_invalid: client.from() is required",
    );
  }
  const builder = client.from(TABLES.inbound);
  for (const method of ["insert", "select", "update"] as const) {
    if (typeof builder[method] !== "function") {
      throw new Error(
        `inbound_supabase_client_invalid: missing .from().${method}()`,
      );
    }
  }
}

function requireMethod(
  builder: InboundRootBuilder | InboundQueryBuilder,
  method: "in" | "gt" | "order" | "limit",
): void {
  if (typeof (builder as InboundQueryBuilder)[method] !== "function") {
    throw new Error(
      `inbound_supabase_client_invalid: missing filter .${method}()`,
    );
  }
}

function isUniqueViolation(error: InboundPostgrestError | null): boolean {
  return error?.code === "23505";
}

function assertOk(
  error: InboundPostgrestError | null,
  context: string,
): void {
  if (error) {
    throw new Error(
      `${context}: ${error.code ?? "unknown"} ${error.message ?? ""}`.trim(),
    );
  }
}

function asRecord(row: unknown): Record<string, unknown> {
  if (!row || typeof row !== "object") {
    throw new Error("inbound_row_invalid");
  }
  return row as Record<string, unknown>;
}

function mapInbound(row: unknown): InboundMessageRecord {
  const r = asRecord(row);
  return {
    id: String(r.id),
    tenantId: (r.tenant_id as string | null) ?? null,
    channelId: (r.channel_id as string | null) ?? null,
    providerKind: r.provider_kind as InboundMessageRecord["providerKind"],
    providerEventId: String(r.provider_event_id),
    providerMessageId: String(r.provider_message_id),
    replyToProviderMessageId:
      (r.reply_to_provider_message_id as string | null) ?? null,
    senderReference: String(r.sender_reference),
    interactionKind: r.interaction_kind as "button" | "text",
    actionKey: (r.action_key as CommunicationActionKey | null) ?? null,
    normalizedText: (r.normalized_text as string | null) ?? null,
    processingStatus:
      r.processing_status as InboundMessageRecord["processingStatus"],
    correlatedOutboundMessageId:
      (r.correlated_outbound_message_id as string | null) ?? null,
    businessCommandId: (r.business_command_id as string | null) ?? null,
    receivedAt: String(r.received_at),
    processedAt: (r.processed_at as string | null) ?? null,
    failedAt: (r.failed_at as string | null) ?? null,
    failureCode: (r.failure_code as string | null) ?? null,
    failureMessage: (r.failure_message as string | null) ?? null,
    payloadSnapshot: (r.payload_snapshot as Record<string, unknown>) ?? {},
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function mapSession(row: unknown): InteractionSessionRecord {
  const r = asRecord(row);
  return {
    id: String(r.id),
    tenantId: String(r.tenant_id),
    channelId: String(r.channel_id),
    guideId: String(r.guide_id),
    inboundMessageId: String(r.inbound_message_id),
    outboundMessageId: String(r.outbound_message_id),
    sessionKind: r.session_kind as InteractionSessionRecord["sessionKind"],
    status: r.status as InteractionSessionRecord["status"],
    businessEntityType: String(r.business_entity_type),
    businessEntityId: String(r.business_entity_id),
    expectedInputKind: "amount_eur_cents",
    attemptCount: Number(r.attempt_count),
    maxAttempts: Number(r.max_attempts),
    expiresAt: String(r.expires_at),
    completedAt: (r.completed_at as string | null) ?? null,
    cancelledAt: (r.cancelled_at as string | null) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function mapConfirmation(row: unknown): GuidePaymentConfirmationRecord {
  const r = asRecord(row);
  return {
    id: String(r.id),
    tenantId: String(r.tenant_id),
    protectionId: String(r.protection_id),
    occurrenceId: String(r.occurrence_id),
    state: r.state as GuidePaymentConfirmationRecord["state"],
    amountDueCents: Number(r.amount_due_cents),
    amountReceivedCents: Number(r.amount_received_cents),
    currency: "EUR",
    confirmedByGuideId: (r.confirmed_by_guide_id as string | null) ?? null,
    sourceOutboundMessageId:
      (r.source_outbound_message_id as string | null) ?? null,
    lastInboundMessageId: (r.last_inbound_message_id as string | null) ?? null,
    lastBusinessCommandId:
      (r.last_business_command_id as string | null) ?? null,
    confirmedAt: (r.confirmed_at as string | null) ?? null,
    verificationInitiatedAt:
      (r.verification_initiated_at as string | null) ?? null,
    autoDebitNeutralized: Boolean(r.auto_debit_neutralized),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

// ---------------------------------------------------------------------------
// Inbound messages
// ---------------------------------------------------------------------------

export function createSupabaseInboundMessageRepository(
  client: InboundPersistenceClient,
): InboundMessageRepository {
  requireClient(client);

  return {
    async tryInsert(input) {
      const inserted = await client
        .from(TABLES.inbound)
        .insert({
          provider_kind: input.providerKind,
          provider_event_id: input.providerEventId,
          provider_message_id: input.providerMessageId,
          reply_to_provider_message_id: input.replyToProviderMessageId,
          sender_reference: input.senderReference,
          interaction_kind: input.interactionKind,
          action_key: input.actionKey,
          normalized_text: input.normalizedText,
          payload_snapshot: input.payloadSnapshot,
          received_at: input.receivedAt,
          processing_status: "received",
        })
        .select("*")
        .single();

      if (isUniqueViolation(inserted.error)) {
        const existing = await client
          .from(TABLES.inbound)
          .select("*")
          .eq("provider_kind", input.providerKind)
          .eq("provider_event_id", input.providerEventId)
          .maybeSingle();
        assertOk(existing.error, "inbound_try_insert_dedupe_lookup");
        if (!existing.data) throw new Error("inbound_duplicate_missing_row");
        return { outcome: "duplicate", record: mapInbound(existing.data) };
      }

      assertOk(inserted.error, "inbound_try_insert");
      if (!inserted.data) throw new Error("inbound_insert_failed");
      return { outcome: "inserted", record: mapInbound(inserted.data) };
    },

    async claimForProcessing(id) {
      const builder = asInboundQuery(client.from(TABLES.inbound)).update({
        processing_status: "processing",
      });
      requireMethod(builder, "in");

      const claimed = await builder
        .eq("id", id)
        .in!("processing_status", [...CLAIMABLE_STATUSES])
        .select("*")
        .maybeSingle();

      assertOk(claimed.error, "inbound_claim");
      if (!claimed.data) return null;
      return mapInbound(claimed.data);
    },

    async update(params) {
      const patch: Record<string, unknown> = {
        processing_status: params.processingStatus,
      };
      if (params.tenantId !== undefined) patch.tenant_id = params.tenantId;
      if (params.channelId !== undefined) patch.channel_id = params.channelId;
      if (params.correlatedOutboundMessageId !== undefined) {
        patch.correlated_outbound_message_id =
          params.correlatedOutboundMessageId;
      }
      if (params.businessCommandId !== undefined) {
        patch.business_command_id = params.businessCommandId;
      }
      if (params.actionKey !== undefined) patch.action_key = params.actionKey;
      if (params.processedAt !== undefined) {
        patch.processed_at = params.processedAt;
      }
      if (params.failedAt !== undefined) patch.failed_at = params.failedAt;
      if (params.failureCode !== undefined) {
        patch.failure_code = params.failureCode;
      }
      if (params.failureMessage !== undefined) {
        patch.failure_message = params.failureMessage;
      }

      const updated = await client
        .from(TABLES.inbound)
        .update(patch)
        .eq("id", params.id)
        .select("*")
        .single();

      assertOk(updated.error, "inbound_update");
      if (!updated.data) throw new Error("inbound_not_found");
      return mapInbound(updated.data);
    },

    async findById(id) {
      const found = await client
        .from(TABLES.inbound)
        .select("*")
        .eq("id", id)
        .maybeSingle();
      assertOk(found.error, "inbound_find");
      return found.data ? mapInbound(found.data) : null;
    },
  };
}

// ---------------------------------------------------------------------------
// Interaction sessions
// ---------------------------------------------------------------------------

export function createSupabaseInteractionSessionRepository(
  client: InboundPersistenceClient,
): InteractionSessionRepository {
  requireClient(client);

  return {
    async create(input) {
      const insertRow: Record<string, unknown> = {
        tenant_id: input.tenantId,
        channel_id: input.channelId,
        guide_id: input.guideId,
        inbound_message_id: input.inboundMessageId,
        outbound_message_id: input.outboundMessageId,
        session_kind: input.sessionKind,
        status: input.status,
        business_entity_type: input.businessEntityType,
        business_entity_id: input.businessEntityId,
        expected_input_kind: input.expectedInputKind,
        attempt_count: input.attemptCount,
        max_attempts: input.maxAttempts,
        expires_at: input.expiresAt,
      };
      if (input.id) insertRow.id = input.id;

      const inserted = await client
        .from(TABLES.sessions)
        .insert(insertRow)
        .select("*")
        .single();

      assertOk(inserted.error, "session_create");
      if (!inserted.data) throw new Error("session_insert_failed");
      return mapSession(inserted.data);
    },

    async findActive({ tenantId, channelId, guideId, now }) {
      const probe = asInboundQuery(client.from(TABLES.sessions)).select("*");
      requireMethod(probe, "gt");

      const filtered = probe
        .eq("tenant_id", tenantId)
        .eq("channel_id", channelId)
        .eq("guide_id", guideId)
        .eq("status", "awaiting_input")
        .gt!("expires_at", now);

      let found: InboundPostgrestResult;
      if (
        typeof filtered.order === "function" &&
        typeof filtered.limit === "function"
      ) {
        const ordered = filtered.order("created_at", { ascending: false });
        requireMethod(ordered, "limit");
        found = await ordered.limit!(1).maybeSingle();
      } else {
        found = await filtered.maybeSingle();
      }

      assertOk(found.error, "session_find_active");

      const rows = Array.isArray(found.data)
        ? found.data
        : found.data
          ? [found.data]
          : [];
      if (rows.length === 0) return null;
      return mapSession(rows[0]);
    },

    async incrementAttempts(id) {
      const current = await client
        .from(TABLES.sessions)
        .select("*")
        .eq("id", id)
        .maybeSingle();
      assertOk(current.error, "session_increment_read");
      if (!current.data) throw new Error("session_not_found");

      const next = Number(asRecord(current.data).attempt_count) + 1;
      const updated = await client
        .from(TABLES.sessions)
        .update({ attempt_count: next })
        .eq("id", id)
        .select("*")
        .single();
      assertOk(updated.error, "session_increment");
      if (!updated.data) throw new Error("session_update_failed");
      return mapSession(updated.data);
    },

    async setStatus({ id, status, at }) {
      const patch: Record<string, unknown> = { status };
      if (status === "completed") patch.completed_at = at;
      if (
        status === "cancelled" ||
        status === "failed" ||
        status === "expired"
      ) {
        patch.cancelled_at = at;
      }

      const updated = await client
        .from(TABLES.sessions)
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      assertOk(updated.error, "session_set_status");
      if (!updated.data) throw new Error("session_not_found");
      return mapSession(updated.data);
    },
  };
}

// ---------------------------------------------------------------------------
// Guide payment confirmation
// ---------------------------------------------------------------------------

export function createSupabaseGuidePaymentConfirmationRepository(
  client: InboundPersistenceClient,
): GuidePaymentConfirmationRepository {
  requireClient(client);

  async function findByBusinessKey(params: {
    tenantId: string;
    protectionId: string;
    occurrenceId: string;
  }): Promise<GuidePaymentConfirmationRecord | null> {
    const found = await client
      .from(TABLES.confirmation)
      .select("*")
      .eq("tenant_id", params.tenantId)
      .eq("protection_id", params.protectionId)
      .eq("occurrence_id", params.occurrenceId)
      .maybeSingle();

    assertOk(found.error, "confirmation_find");
    if (!found.data) return null;
    return mapConfirmation(found.data);
  }

  return {
    async getOrCreate(params) {
      const existing = await findByBusinessKey(params);
      if (existing) return existing;

      const initial = createInitialGuidePaymentConfirmation({
        id: crypto.randomUUID(),
        tenantId: params.tenantId,
        protectionId: params.protectionId,
        occurrenceId: params.occurrenceId,
        amountDueCents: params.amountDueCents,
        now: params.now,
        sourceOutboundMessageId: params.sourceOutboundMessageId,
      });

      const inserted = await client
        .from(TABLES.confirmation)
        .insert({
          id: initial.id,
          tenant_id: initial.tenantId,
          protection_id: initial.protectionId,
          occurrence_id: initial.occurrenceId,
          state: initial.state,
          amount_due_cents: initial.amountDueCents,
          amount_received_cents: initial.amountReceivedCents,
          currency: initial.currency,
          source_outbound_message_id: initial.sourceOutboundMessageId,
          auto_debit_neutralized: initial.autoDebitNeutralized,
          created_at: initial.createdAt,
          updated_at: initial.updatedAt,
        })
        .select("*")
        .single();

      if (isUniqueViolation(inserted.error)) {
        const raced = await findByBusinessKey(params);
        if (raced) return raced;
        throw new Error("confirmation_race_missing");
      }

      assertOk(inserted.error, "confirmation_get_or_create");
      if (!inserted.data) throw new Error("confirmation_insert_failed");
      return mapConfirmation(inserted.data);
    },

    async save(record) {
      const updated = await client
        .from(TABLES.confirmation)
        .update({
          state: record.state,
          amount_due_cents: record.amountDueCents,
          amount_received_cents: record.amountReceivedCents,
          currency: record.currency,
          confirmed_by_guide_id: record.confirmedByGuideId,
          source_outbound_message_id: record.sourceOutboundMessageId,
          last_inbound_message_id: record.lastInboundMessageId,
          last_business_command_id: record.lastBusinessCommandId,
          confirmed_at: record.confirmedAt,
          verification_initiated_at: record.verificationInitiatedAt,
          auto_debit_neutralized: record.autoDebitNeutralized,
          updated_at: record.updatedAt,
        })
        .eq("id", record.id)
        .select("*")
        .single();

      assertOk(updated.error, "confirmation_save");
      if (!updated.data) throw new Error("confirmation_not_found");
      return mapConfirmation(updated.data);
    },

    findByBusinessKey,
  };
}
