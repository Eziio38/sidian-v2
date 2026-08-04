/**
 * Adapter claim batch SQL pour email_outbox (RPC claim_email_outbox_batch).
 * Complète le repository Email (A) qui claim encore row-par-row.
 */

import type { EmailOutboxRecord } from "../../../email/types";

export type EmailClaimClient = {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
};

function mapRow(row: unknown): EmailOutboxRecord {
  if (!row || typeof row !== "object") {
    throw new Error("email_outbox_row_invalid");
  }
  const r = row as Record<string, unknown>;
  return {
    id: String(r.id),
    tenantId: String(r.tenant_id),
    templateKey: r.template_key as EmailOutboxRecord["templateKey"],
    templateLocale: (r.template_locale as EmailOutboxRecord["templateLocale"]) ?? "fr",
    recipientEmail: String(r.recipient_email),
    recipientName: (r.recipient_name as string | null) ?? null,
    recipientEmailHash: String(r.recipient_email_hash),
    subject: String(r.subject),
    bodyText: String(r.body_text),
    bodyHtml: String(r.body_html),
    variablesSnapshot: (r.variables_snapshot as Record<string, unknown>) ?? {},
    relatedEntityType:
      (r.related_entity_type as EmailOutboxRecord["relatedEntityType"]) ?? null,
    relatedEntityId: (r.related_entity_id as string | null) ?? null,
    status: r.status as EmailOutboxRecord["status"],
    idempotencyKey: String(r.idempotency_key),
    providerKind: r.provider_kind as EmailOutboxRecord["providerKind"],
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

/**
 * Claim SQL multi-worker. Les rows retournées sont déjà en `processing`
 * avec lease — le processor Email (claimForProcessing) les skippera
 * si on les repasse ; utiliser plutôt pour inventaire / reclaim.
 */
export async function claimEmailOutboxBatchSql(
  client: EmailClaimClient,
  params: { limit: number; leaseSeconds?: number },
): Promise<EmailOutboxRecord[]> {
  const result = await client.rpc("claim_email_outbox_batch", {
    p_limit: params.limit,
    p_lease_seconds: params.leaseSeconds ?? 60,
  });
  if (result.error) {
    throw new Error(
      `email_claim_batch: ${result.error.code ?? "unknown"} ${result.error.message ?? ""}`.trim(),
    );
  }
  const rows = Array.isArray(result.data)
    ? result.data
    : result.data
      ? [result.data]
      : [];
  return rows.map(mapRow);
}
