/**
 * G1-P — repository Supabase pour communication_messages.
 * Client PostgREST injecté (typiquement service_role). Mapping snake_case ↔ camelCase.
 * P0 : claim batch SQL (SKIP LOCKED + lease) via RPC.
 */

import {
  canTransitionMessageStatus,
  MAX_SEND_ATTEMPTS,
  type ClaimOutboundBatchParams,
  type CommunicationMessageRecord,
  type CommunicationMessageRepository,
  type CommunicationMessageStatus,
  type QueueOutboundMessageInput,
} from "./types";

export type MessagePostgrestError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

export type MessagePostgrestResult = {
  data: unknown;
  error: MessagePostgrestError | null;
};

/**
 * Chaîne fluent PostgREST (select/insert/update → filtres → terminal).
 * Volontairement large : from() réel Supabase n’expose pas eq/single.
 */
export type MessageQueryBuilder = {
  select(columns?: string): MessageQueryBuilder;
  insert(values: Record<string, unknown>): MessageQueryBuilder;
  update(values: Record<string, unknown>): MessageQueryBuilder;
  eq(column: string, value: unknown): MessageQueryBuilder;
  in?(column: string, values: readonly unknown[]): MessageQueryBuilder;
  order?(
    column: string,
    options?: { ascending?: boolean },
  ): MessageQueryBuilder;
  limit?(count: number): MessageQueryBuilder;
  maybeSingle(): PromiseLike<MessagePostgrestResult>;
  single(): PromiseLike<MessagePostgrestResult>;
};

/** Root builder renvoyé par from() — select/insert/update uniquement. */
export type MessageRootBuilder = Pick<
  MessageQueryBuilder,
  "select" | "insert" | "update"
>;

/**
 * Client injecté. Les clients Supabase JS réels sont acceptés via assertion
 * à la frontière (génériques PostgREST trop profonds pour l’assignabilité).
 */
export type MessagePersistenceClient = {
  from(relation: string): MessageRootBuilder;
  rpc?(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<MessagePostgrestResult>;
};

const TABLE = "communication_messages" as const;

function asMessageQuery(builder: MessageRootBuilder): MessageQueryBuilder {
  return builder as MessageQueryBuilder;
}

function requireClient(client: MessagePersistenceClient): void {
  if (!client || typeof client.from !== "function") {
    throw new Error(
      "message_supabase_client_invalid: client.from() is required",
    );
  }
  const builder = client.from(TABLE);
  for (const method of ["insert", "select", "update"] as const) {
    if (typeof builder[method] !== "function") {
      throw new Error(
        `message_supabase_client_invalid: missing .from().${method}()`,
      );
    }
  }
}

function isUniqueViolation(error: MessagePostgrestError | null): boolean {
  return error?.code === "23505";
}

function assertOk(
  error: MessagePostgrestError | null,
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
    throw new Error("communication_message_row_invalid");
  }
  return row as Record<string, unknown>;
}

function mapMessage(row: unknown): CommunicationMessageRecord {
  const r = asRecord(row);
  return {
    id: String(r.id),
    tenantId: String(r.tenant_id),
    channelId: String(r.channel_id),
    providerKind: r.provider_kind as CommunicationMessageRecord["providerKind"],
    direction: r.direction as CommunicationMessageRecord["direction"],
    recipientReference: String(r.recipient_reference),
    messageKind: String(r.message_kind),
    templateKey: (r.template_key as string | null) ?? null,
    templateLocale: (r.template_locale as string | null) ?? null,
    payloadSnapshot: (r.payload_snapshot as Record<string, unknown>) ?? {},
    status: r.status as CommunicationMessageStatus,
    idempotencyKey: String(r.idempotency_key),
    providerMessageId: (r.provider_message_id as string | null) ?? null,
    attemptCount: Number(r.attempt_count),
    lastErrorCode: (r.last_error_code as string | null) ?? null,
    lastErrorMessage: (r.last_error_message as string | null) ?? null,
    queuedAt: String(r.queued_at),
    sentAt: (r.sent_at as string | null) ?? null,
    deliveredAt: (r.delivered_at as string | null) ?? null,
    readAt: (r.read_at as string | null) ?? null,
    failedAt: (r.failed_at as string | null) ?? null,
    leaseToken: (r.lease_token as string | null) ?? null,
    leaseExpiresAt: (r.lease_expires_at as string | null) ?? null,
    nextAttemptAt: (r.next_attempt_at as string | null) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function queuedInsertRow(input: QueueOutboundMessageInput): Record<string, unknown> {
  return {
    tenant_id: input.tenantId,
    channel_id: input.channelId,
    provider_kind: input.providerKind,
    direction: "outbound",
    recipient_reference: input.recipientReference,
    message_kind: input.messageKind,
    template_key: input.templateKey,
    template_locale: input.templateLocale,
    payload_snapshot: input.payloadSnapshot,
    status: "queued",
    idempotency_key: input.idempotencyKey,
    attempt_count: 0,
  };
}

function isLeaseLostError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("communication_outbound_lease_lost");
}

/**
 * Persistance durable des messages outbound (idempotence tenant + provider_message_id).
 */
export function createSupabaseCommunicationMessageRepository(
  client: MessagePersistenceClient,
): CommunicationMessageRepository {
  requireClient(client);

  function table(): MessageQueryBuilder {
    return asMessageQuery(client.from(TABLE));
  }

  async function findById(id: string): Promise<CommunicationMessageRecord | null> {
    const found = await table()
      .select("*")
      .eq("id", id)
      .maybeSingle();
    assertOk(found.error, "message_find_by_id");
    return found.data ? mapMessage(found.data) : null;
  }

  async function rpcFail(
    messageId: string,
    leaseToken: string,
    errorCode: string,
    errorMessage: string,
    retryable: boolean,
    retryDelaySeconds: number | null,
    maxAttempts: number,
  ): Promise<CommunicationMessageRecord> {
    if (typeof client.rpc !== "function") {
      throw new Error("message_supabase_client_invalid: rpc() required for lease fail");
    }
    const result = await client.rpc("fail_communication_outbound_claim", {
      p_message_id: messageId,
      p_lease_token: leaseToken,
      p_error_code: errorCode,
      p_error_message: errorMessage,
      p_retryable: retryable,
      p_retry_delay_seconds: retryDelaySeconds,
      p_max_attempts: maxAttempts,
    });
    assertOk(result.error, "message_fail_claim");
    if (!result.data) throw new Error("message_fail_claim_empty");
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    return mapMessage(row);
  }

  return {
    async insertQueued(input) {
      const inserted = await table()
        .insert(queuedInsertRow(input))
        .select("*")
        .single();

      if (isUniqueViolation(inserted.error)) {
        const existing = await table()
          .select("*")
          .eq("tenant_id", input.tenantId)
          .eq("idempotency_key", input.idempotencyKey)
          .maybeSingle();
        assertOk(existing.error, "message_insert_dedupe_lookup");
        if (!existing.data) throw new Error("message_duplicate_missing_row");
        return mapMessage(existing.data);
      }

      assertOk(inserted.error, "message_insert_queued");
      if (!inserted.data) throw new Error("message_insert_failed");
      return mapMessage(inserted.data);
    },

    async findByIdempotencyKey(tenantId, idempotencyKey) {
      const found = await table()
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      assertOk(found.error, "message_find_idempotency");
      return found.data ? mapMessage(found.data) : null;
    },

    async findByProviderMessageId(providerKind, providerMessageId) {
      const found = await table()
        .select("*")
        .eq("provider_kind", providerKind)
        .eq("provider_message_id", providerMessageId)
        .maybeSingle();
      assertOk(found.error, "message_find_provider_id");
      return found.data ? mapMessage(found.data) : null;
    },

    findById,

    async claimForSending(messageId) {
      const current = await findById(messageId);
      if (!current || current.status !== "queued") return null;

      const leaseToken =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `lease_${Date.now()}`;
      const leaseExpiresAt = new Date(Date.now() + 60_000).toISOString();
      const nextAttempt = current.attemptCount + 1;
      const claimed = await table()
        .update({
          status: "sending",
          attempt_count: nextAttempt,
          lease_token: leaseToken,
          lease_expires_at: leaseExpiresAt,
          next_attempt_at: null,
        })
        .eq("id", messageId)
        .eq("status", "queued")
        .select("*")
        .maybeSingle();

      assertOk(claimed.error, "message_claim_for_sending");
      if (!claimed.data) return null;
      return mapMessage(claimed.data);
    },

    async claimQueuedBatch(params: ClaimOutboundBatchParams) {
      if (typeof client.rpc !== "function") {
        throw new Error(
          "message_supabase_client_invalid: rpc() required for claimQueuedBatch",
        );
      }
      const result = await client.rpc("claim_communication_outbound_batch", {
        p_limit: params.limit,
        p_lease_seconds: params.leaseSeconds ?? 60,
        p_max_attempts: params.maxAttempts ?? MAX_SEND_ATTEMPTS,
      });
      assertOk(result.error, "message_claim_batch");
      const rows = Array.isArray(result.data)
        ? result.data
        : result.data
          ? [result.data]
          : [];
      return rows.map(mapMessage);
    },

    async markAccepted(messageId, providerMessageId, acceptedAt, leaseToken) {
      if (leaseToken && typeof client.rpc === "function") {
        const result = await client.rpc("complete_communication_outbound_claim", {
          p_message_id: messageId,
          p_lease_token: leaseToken,
          p_provider_message_id: providerMessageId,
          p_accepted_at: acceptedAt,
        });
        assertOk(result.error, "message_complete_claim");
        if (!result.data) throw new Error("message_not_found");
        const row = Array.isArray(result.data) ? result.data[0] : result.data;
        return mapMessage(row);
      }

      const updated = await table()
        .update({
          status: "accepted",
          provider_message_id: providerMessageId,
          sent_at: acceptedAt,
          last_error_code: null,
          last_error_message: null,
          lease_token: null,
          lease_expires_at: null,
          next_attempt_at: null,
        })
        .eq("id", messageId)
        .select("*")
        .single();
      assertOk(updated.error, "message_mark_accepted");
      if (!updated.data) throw new Error("message_not_found");
      return mapMessage(updated.data);
    },

    async markFailed(
      messageId,
      errorCode,
      errorMessage,
      attemptCount,
      options,
    ) {
      const terminal = attemptCount >= MAX_SEND_ATTEMPTS;
      if (options?.leaseToken && typeof client.rpc === "function") {
        try {
          return await rpcFail(
            messageId,
            options.leaseToken,
            errorCode,
            errorMessage,
            !terminal,
            terminal ? null : (options.retryDelaySeconds ?? 30),
            MAX_SEND_ATTEMPTS,
          );
        } catch (error) {
          if (isLeaseLostError(error)) throw error;
          throw error;
        }
      }

      const updated = await table()
        .update({
          status: terminal ? "failed" : "queued",
          attempt_count: attemptCount,
          last_error_code: errorCode,
          last_error_message: errorMessage,
          lease_token: null,
          lease_expires_at: null,
          next_attempt_at: terminal
            ? null
            : new Date(
                Date.now() + (options?.retryDelaySeconds ?? 30) * 1000,
              ).toISOString(),
          ...(terminal ? { failed_at: new Date().toISOString() } : {}),
        })
        .eq("id", messageId)
        .select("*")
        .single();
      assertOk(updated.error, "message_mark_failed");
      if (!updated.data) throw new Error("message_not_found");
      return mapMessage(updated.data);
    },

    async finalizeFailed(
      messageId,
      errorCode,
      errorMessage,
      attemptCount,
      leaseToken,
    ) {
      if (leaseToken && typeof client.rpc === "function") {
        return rpcFail(
          messageId,
          leaseToken,
          errorCode,
          errorMessage,
          false,
          null,
          MAX_SEND_ATTEMPTS,
        );
      }

      const failedAt = new Date().toISOString();
      const updated = await table()
        .update({
          status: "failed",
          attempt_count: attemptCount,
          last_error_code: errorCode,
          last_error_message: errorMessage,
          failed_at: failedAt,
          lease_token: null,
          lease_expires_at: null,
          next_attempt_at: null,
        })
        .eq("id", messageId)
        .select("*")
        .single();
      assertOk(updated.error, "message_finalize_failed");
      if (!updated.data) throw new Error("message_not_found");
      return mapMessage(updated.data);
    },

    async applyStatusFromWebhook(params) {
      const current = await findById(params.messageId);
      if (!current) return null;
      if (!canTransitionMessageStatus(current.status, params.status)) {
        return current;
      }

      const patch: Record<string, unknown> = {
        status: params.status,
      };
      if (params.status === "sent" && !current.sentAt) {
        patch.sent_at = params.at;
      }
      if (params.status === "delivered") patch.delivered_at = params.at;
      if (params.status === "read") patch.read_at = params.at;
      if (params.status === "failed") {
        patch.failed_at = params.at;
        if (params.errorCode !== undefined) {
          patch.last_error_code = params.errorCode;
        }
        if (params.errorMessage !== undefined) {
          patch.last_error_message = params.errorMessage;
        }
      }

      const updated = await table()
        .update(patch)
        .eq("id", params.messageId)
        .select("*")
        .single();
      assertOk(updated.error, "message_apply_webhook_status");
      if (!updated.data) return null;
      return mapMessage(updated.data);
    },

    async listQueued(limit) {
      const listed = table()
        .select("*")
        .eq("status", "queued")
        .order?.("queued_at", { ascending: true })
        .limit?.(limit);

      if (
        !listed ||
        typeof (listed as { then?: unknown }).then !== "function"
      ) {
        throw new Error(
          "message_supabase_client_invalid: list query must be thenable (order/limit required)",
        );
      }

      const result = await (listed as unknown as PromiseLike<MessagePostgrestResult>);
      assertOk(result.error, "message_list_queued");
      const rows = Array.isArray(result.data)
        ? result.data
        : result.data
          ? [result.data]
          : [];
      return rows.map(mapMessage);
    },
  };
}
