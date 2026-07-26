/**
 * Repository Supabase pour email_outbox.
 * Client PostgREST injecté (typiquement service_role).
 */

import type {
  EmailDeliveryStatus,
  EmailLocale,
  EmailOutboxRecord,
  EmailProviderKind,
  EmailRelatedEntityType,
  EmailTemplateKey,
} from "../types";
import type {
  EmailOutboxRepository,
  InsertEmailOutboxInput,
} from "./repository";

export type EmailPostgrestError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

export type EmailPostgrestResult = {
  data: unknown;
  error: EmailPostgrestError | null;
};

export type EmailQueryBuilder = {
  select(columns?: string): EmailQueryBuilder;
  insert(values: Record<string, unknown>): EmailQueryBuilder;
  update(values: Record<string, unknown>): EmailQueryBuilder;
  eq(column: string, value: unknown): EmailQueryBuilder;
  in?(column: string, values: readonly unknown[]): EmailQueryBuilder;
  order?(
    column: string,
    options?: { ascending?: boolean },
  ): EmailQueryBuilder;
  limit?(count: number): EmailQueryBuilder;
  maybeSingle(): PromiseLike<EmailPostgrestResult>;
  single(): PromiseLike<EmailPostgrestResult>;
};

export type EmailRootBuilder = Pick<
  EmailQueryBuilder,
  "select" | "insert" | "update"
>;

export type EmailPersistenceClient = {
  from(relation: string): EmailRootBuilder;
};

const TABLE = "email_outbox" as const;

function asEmailQuery(builder: EmailRootBuilder): EmailQueryBuilder {
  return builder as EmailQueryBuilder;
}

function requireClient(client: EmailPersistenceClient): void {
  if (!client || typeof client.from !== "function") {
    throw new Error(
      "email_supabase_client_invalid: client.from() is required",
    );
  }
  const builder = client.from(TABLE);
  for (const method of ["insert", "select", "update"] as const) {
    if (typeof builder[method] !== "function") {
      throw new Error(
        `email_supabase_client_invalid: missing .from().${method}()`,
      );
    }
  }
}

function isUniqueViolation(error: EmailPostgrestError | null): boolean {
  return error?.code === "23505";
}

function assertOk(error: EmailPostgrestError | null, context: string): void {
  if (error) {
    throw new Error(
      `${context}: ${error.code ?? "unknown"} ${error.message ?? ""}`.trim(),
    );
  }
}

function asRecord(row: unknown): Record<string, unknown> {
  if (!row || typeof row !== "object") {
    throw new Error("email_outbox_row_invalid");
  }
  return row as Record<string, unknown>;
}

function mapOutbox(row: unknown): EmailOutboxRecord {
  const r = asRecord(row);
  return {
    id: String(r.id),
    tenantId: String(r.tenant_id),
    templateKey: r.template_key as EmailTemplateKey,
    templateLocale: (r.template_locale as EmailLocale) ?? "fr",
    recipientEmail: String(r.recipient_email),
    recipientName: (r.recipient_name as string | null) ?? null,
    recipientEmailHash: String(r.recipient_email_hash),
    subject: String(r.subject),
    bodyText: String(r.body_text),
    bodyHtml: String(r.body_html),
    variablesSnapshot: (r.variables_snapshot as Record<string, unknown>) ?? {},
    relatedEntityType:
      (r.related_entity_type as EmailRelatedEntityType | null) ?? null,
    relatedEntityId: (r.related_entity_id as string | null) ?? null,
    status: r.status as EmailDeliveryStatus,
    idempotencyKey: String(r.idempotency_key),
    providerKind: r.provider_kind as EmailProviderKind,
    providerMessageId: (r.provider_message_id as string | null) ?? null,
    attemptCount: Number(r.attempt_count),
    maxAttempts: Number(r.max_attempts ?? 4),
    lastErrorCode: (r.last_error_code as string | null) ?? null,
    lastErrorMessage: (r.last_error_message as string | null) ?? null,
    queuedAt: String(r.queued_at),
    processedAt: (r.processed_at as string | null) ?? null,
    sentAt: (r.sent_at as string | null) ?? null,
    failedAt: (r.failed_at as string | null) ?? null,
    deadLetteredAt: (r.dead_lettered_at as string | null) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function queuedInsertRow(input: InsertEmailOutboxInput): Record<string, unknown> {
  return {
    tenant_id: input.tenantId,
    template_key: input.templateKey,
    template_locale: input.templateLocale,
    recipient_email: input.recipientEmail,
    recipient_name: input.recipientName,
    recipient_email_hash: input.recipientEmailHash,
    subject: input.subject,
    body_text: input.bodyText,
    body_html: input.bodyHtml,
    variables_snapshot: input.variablesSnapshot,
    related_entity_type: input.relatedEntityType,
    related_entity_id: input.relatedEntityId,
    status: "queued",
    idempotency_key: input.idempotencyKey,
    provider_kind: input.providerKind,
    attempt_count: 0,
    max_attempts: input.maxAttempts ?? 4,
  };
}

export function createSupabaseEmailOutboxRepository(
  client: EmailPersistenceClient,
): EmailOutboxRepository {
  requireClient(client);

  function table(): EmailQueryBuilder {
    return asEmailQuery(client.from(TABLE));
  }

  async function findById(id: string): Promise<EmailOutboxRecord | null> {
    const found = await table().select("*").eq("id", id).maybeSingle();
    assertOk(found.error, "email_find_by_id");
    return found.data ? mapOutbox(found.data) : null;
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
        assertOk(existing.error, "email_insert_dedupe_lookup");
        if (!existing.data) throw new Error("email_duplicate_missing_row");
        return mapOutbox(existing.data);
      }

      assertOk(inserted.error, "email_insert_queued");
      if (!inserted.data) throw new Error("email_insert_failed");
      return mapOutbox(inserted.data);
    },

    async findByIdempotencyKey(tenantId, idempotencyKey) {
      const found = await table()
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      assertOk(found.error, "email_find_idempotency");
      return found.data ? mapOutbox(found.data) : null;
    },

    findById,

    async findByProviderMessageId(providerKind, providerMessageId) {
      const found = await table()
        .select("*")
        .eq("provider_kind", providerKind)
        .eq("provider_message_id", providerMessageId)
        .maybeSingle();
      assertOk(found.error, "email_find_provider_id");
      return found.data ? mapOutbox(found.data) : null;
    },

    async claimForProcessing(id) {
      const current = await findById(id);
      if (!current || (current.status !== "queued" && current.status !== "failed")) {
        return null;
      }
      // Claim depuis queued uniquement (failed terminal n'est pas rejouable).
      if (current.status !== "queued") return null;

      const nextAttempt = current.attemptCount + 1;
      const claimed = await table()
        .update({
          status: "processing",
          attempt_count: nextAttempt,
          processed_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("status", "queued")
        .select("*")
        .maybeSingle();

      assertOk(claimed.error, "email_claim_for_processing");
      if (!claimed.data) return null;
      return mapOutbox(claimed.data);
    },

    async markSent(id, providerMessageId, sentAt) {
      const updated = await table()
        .update({
          status: "sent",
          provider_message_id: providerMessageId,
          sent_at: sentAt,
          last_error_code: null,
          last_error_message: null,
        })
        .eq("id", id)
        .select("*")
        .single();
      assertOk(updated.error, "email_mark_sent");
      if (!updated.data) throw new Error("email_outbox_not_found");
      return mapOutbox(updated.data);
    },

    async markFailedRetryable(id, errorCode, errorMessage, attemptCount) {
      const updated = await table()
        .update({
          status: "queued",
          attempt_count: attemptCount,
          last_error_code: errorCode,
          last_error_message: errorMessage,
        })
        .eq("id", id)
        .select("*")
        .single();
      assertOk(updated.error, "email_mark_failed_retryable");
      if (!updated.data) throw new Error("email_outbox_not_found");
      return mapOutbox(updated.data);
    },

    async markFailedTerminal(id, errorCode, errorMessage, attemptCount) {
      const failedAt = new Date().toISOString();
      const updated = await table()
        .update({
          status: "failed",
          attempt_count: attemptCount,
          last_error_code: errorCode,
          last_error_message: errorMessage,
          failed_at: failedAt,
        })
        .eq("id", id)
        .select("*")
        .single();
      assertOk(updated.error, "email_mark_failed_terminal");
      if (!updated.data) throw new Error("email_outbox_not_found");
      return mapOutbox(updated.data);
    },

    async markDeadLetter(id, errorCode, errorMessage, attemptCount) {
      const deadAt = new Date().toISOString();
      const updated = await table()
        .update({
          status: "dead_letter",
          attempt_count: attemptCount,
          last_error_code: errorCode,
          last_error_message: errorMessage,
          dead_lettered_at: deadAt,
        })
        .eq("id", id)
        .select("*")
        .single();
      assertOk(updated.error, "email_mark_dead_letter");
      if (!updated.data) throw new Error("email_outbox_not_found");
      return mapOutbox(updated.data);
    },

    async listClaimable(limit) {
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
          "email_supabase_client_invalid: list query must be thenable (order/limit required)",
        );
      }

      const result = await (listed as unknown as PromiseLike<EmailPostgrestResult>);
      assertOk(result.error, "email_list_claimable");
      const rows = Array.isArray(result.data)
        ? result.data
        : result.data
          ? [result.data]
          : [];
      return rows.map(mapOutbox);
    },
  };
}
