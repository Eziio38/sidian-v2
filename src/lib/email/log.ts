import type { ServerLogLevel } from "@/lib/observability/server-logger";
import { logServerEvent } from "@/lib/observability/server-logger";

/**
 * Logs email sans PII : pas d'adresse, pas de subject/body, pas de variables.
 * Contexte allowlisté uniquement.
 */
export type EmailLogContext = {
  outboxId?: string;
  tenantId?: string;
  templateKey?: string;
  status?: string;
  attemptCount?: number;
  providerKind?: string;
  providerMessageId?: string | null;
  recipientEmailHash?: string;
  errorCode?: string;
  outcome?: string;
};

export function logEmailEvent(
  level: ServerLogLevel,
  event: string,
  context: EmailLogContext = {},
): void {
  logServerEvent(level, event, {
    ...(context.outboxId ? { outbox_id: context.outboxId } : {}),
    ...(context.tenantId ? { tenant_id: context.tenantId } : {}),
    ...(context.templateKey ? { template_key: context.templateKey } : {}),
    ...(context.status ? { status: context.status } : {}),
    ...(context.attemptCount !== undefined
      ? { attempt_count: context.attemptCount }
      : {}),
    ...(context.providerKind ? { provider_kind: context.providerKind } : {}),
    // Éviter *_message_* / *email* : redaction automatique du logger serveur.
    ...(context.providerMessageId
      ? { provider_ref: context.providerMessageId }
      : {}),
    ...(context.recipientEmailHash
      ? { recipient_hash: context.recipientEmailHash }
      : {}),
    ...(context.errorCode ? { error_code: context.errorCode } : {}),
    ...(context.outcome ? { outcome: context.outcome } : {}),
  });
}
