/**
 * G1-Q / G1-P live — repository persistant pour communication_webhook_events.
 * Remplace le dépôt mémoire en mode live. Client PostgREST injecté.
 */

import type { WebhookEventRepository } from "./process";

export type WebhookEventPostgrestError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

export type WebhookEventPostgrestResult = {
  data: unknown;
  error: WebhookEventPostgrestError | null;
};

export type WebhookEventQueryBuilder = {
  select(columns?: string): WebhookEventQueryBuilder;
  insert(values: Record<string, unknown>): WebhookEventQueryBuilder;
  update(values: Record<string, unknown>): WebhookEventQueryBuilder;
  eq(column: string, value: unknown): WebhookEventQueryBuilder;
  maybeSingle(): PromiseLike<WebhookEventPostgrestResult>;
};

export type WebhookEventRootBuilder = Pick<
  WebhookEventQueryBuilder,
  "select" | "insert" | "update"
>;

export type WebhookEventPersistenceClient = {
  from(relation: string): WebhookEventRootBuilder;
};

const TABLE = "communication_webhook_events" as const;

function requireClient(client: WebhookEventPersistenceClient): void {
  if (!client || typeof client.from !== "function") {
    throw new Error(
      "webhook_event_supabase_client_invalid: client.from() is required",
    );
  }
  const builder = client.from(TABLE);
  for (const method of ["insert", "select", "update"] as const) {
    if (typeof builder[method] !== "function") {
      throw new Error(
        `webhook_event_supabase_client_invalid: missing .from().${method}()`,
      );
    }
  }
}

function isUniqueViolation(error: WebhookEventPostgrestError | null): boolean {
  return error?.code === "23505";
}

function assertOk(
  error: WebhookEventPostgrestError | null,
  context: string,
): void {
  if (error) {
    throw new Error(
      `${context}: ${error.code ?? "unknown"} ${error.message ?? ""}`.trim(),
    );
  }
}

/**
 * Persistance durable des événements webhook (déduplication après redémarrage).
 */
export function createSupabaseWebhookEventRepository(
  client: WebhookEventPersistenceClient,
): WebhookEventRepository {
  requireClient(client);

  return {
    async tryInsert(params) {
      const inserted = await client
        .from(TABLE)
        .insert({
          provider_kind: params.providerKind,
          dedupe_key: params.dedupeKey,
          provider_event_id: params.providerEventId,
          payload_snapshot: params.payloadSnapshot,
          processing_status: "received",
        })
        .select("dedupe_key")
        .maybeSingle();

      if (!inserted.error && inserted.data) {
        return "inserted";
      }

      if (isUniqueViolation(inserted.error)) {
        return "duplicate";
      }

      assertOk(inserted.error, "webhook_event_try_insert");
      throw new Error("webhook_event_try_insert_empty");
    },

    async markProcessed(dedupeKey, communicationMessageId) {
      const updated = await client
        .from(TABLE)
        .update({
          processing_status: "processed",
          processed_at: new Date().toISOString(),
          communication_message_id: communicationMessageId,
        })
        .eq("dedupe_key", dedupeKey)
        .eq("provider_kind", "whatsapp_sidian")
        .select("dedupe_key")
        .maybeSingle();

      assertOk(updated.error, "webhook_event_mark_processed");
    },
  };
}

/**
 * Live exige un repository persistant — jamais de mémoire processus.
 */
export function assertLiveWebhookPersistence(params: {
  mode: "disabled" | "stub" | "live";
  isMemory: boolean;
}): void {
  if (params.mode === "live" && params.isMemory) {
    throw new Error(
      "WhatsApp live mode requires persistent webhook event repository (Supabase).",
    );
  }
}
