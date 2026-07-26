import type { EmailEnv } from "../env";
import { logEmailEvent } from "../log";
import {
  createEmailProviderFromEnv,
  isEmailProviderError,
  type EmailProvider,
} from "../provider";
import type { EmailMessage, EmailOutboxRecord } from "../types";
import type { EmailOutboxRepository } from "./repository";

export type ProcessEmailResult =
  | { outcome: "sent"; record: EmailOutboxRecord }
  | {
      outcome: "failed";
      record: EmailOutboxRecord;
      retryable: boolean;
    }
  | { outcome: "dead_letter"; record: EmailOutboxRecord }
  | { outcome: "skipped"; reason: string };

function buildMessageFromRecord(
  record: EmailOutboxRecord,
  env: EmailEnv,
): EmailMessage | null {
  if (!env.fromAddress) return null;
  return {
    to: {
      email: record.recipientEmail,
      ...(record.recipientName ? { name: record.recipientName } : {}),
    },
    from: {
      email: env.fromAddress,
      ...(env.fromName ? { name: env.fromName } : {}),
    },
    ...(env.replyTo ? { replyTo: env.replyTo } : {}),
    subject: record.subject,
    text: record.bodyText,
    html: record.bodyHtml,
    idempotencyKey: record.idempotencyKey,
    tags: [
      { name: "template_key", value: record.templateKey },
      { name: "tenant_hash", value: record.tenantId.slice(0, 8) },
    ],
    headers: {
      "X-Sidian-Template": record.templateKey,
      "X-Sidian-Outbox-Id": record.id,
    },
  };
}

/**
 * Traite un message queued → processing → sent | failed | dead_letter.
 * Retries bornés : maxAttempts (défaut 4 = 1 + 3).
 * Jamais de second message logique : même idempotency_key / même row.
 */
export async function processEmailOutboxRecord(params: {
  outboxId: string;
  outbox: EmailOutboxRepository;
  env: EmailEnv;
  provider?: EmailProvider;
}): Promise<ProcessEmailResult> {
  const claimed = await params.outbox.claimForProcessing(params.outboxId);
  if (!claimed) {
    return { outcome: "skipped", reason: "not_claimable" };
  }

  logEmailEvent("info", "email.process.claimed", {
    outboxId: claimed.id,
    tenantId: claimed.tenantId,
    templateKey: claimed.templateKey,
    attemptCount: claimed.attemptCount,
    recipientEmailHash: claimed.recipientEmailHash,
  });

  if (claimed.attemptCount > claimed.maxAttempts) {
    const dead = await params.outbox.markDeadLetter(
      claimed.id,
      "max_attempts",
      "max_attempts_exceeded",
      claimed.attemptCount,
    );
    logEmailEvent("warn", "email.process.dead_letter", {
      outboxId: dead.id,
      tenantId: dead.tenantId,
      templateKey: dead.templateKey,
      attemptCount: dead.attemptCount,
      errorCode: "max_attempts",
    });
    return { outcome: "dead_letter", record: dead };
  }

  const provider =
    params.provider ?? createEmailProviderFromEnv(params.env);

  if (params.env.mode === "live" && !params.env.fromAddress) {
    const failed = await params.outbox.markFailedTerminal(
      claimed.id,
      "configuration_error",
      "from_address_missing",
      claimed.attemptCount,
    );
    return { outcome: "failed", record: failed, retryable: false };
  }

  // Stub : fromAddress optionnel — utilise un from technique local.
  const envForSend: EmailEnv =
    params.env.fromAddress
      ? params.env
      : {
          ...params.env,
          fromAddress: "noreply@sidian.local",
          fromName: params.env.fromName ?? "Sidian",
        };

  const message = buildMessageFromRecord(claimed, envForSend);
  if (!message) {
    const failed = await params.outbox.markFailedTerminal(
      claimed.id,
      "validation_error",
      "message_incomplete",
      claimed.attemptCount,
    );
    return { outcome: "failed", record: failed, retryable: false };
  }

  try {
    const result = await provider.send({
      message,
      timeoutMs: params.env.httpTimeoutMs,
    });

    const sent = await params.outbox.markSent(
      claimed.id,
      result.providerMessageId,
      result.sentAt,
    );

    logEmailEvent("info", "email.process.sent", {
      outboxId: sent.id,
      tenantId: sent.tenantId,
      templateKey: sent.templateKey,
      providerKind: sent.providerKind,
      providerMessageId: sent.providerMessageId,
      attemptCount: sent.attemptCount,
      recipientEmailHash: sent.recipientEmailHash,
    });

    return { outcome: "sent", record: sent };
  } catch (error) {
    const category = isEmailProviderError(error)
      ? error.category
      : "unknown";
    const code = isEmailProviderError(error)
      ? error.message
      : "unknown_error";
    const retryable = isEmailProviderError(error)
      ? error.retryable && claimed.attemptCount < claimed.maxAttempts
      : claimed.attemptCount < claimed.maxAttempts;

    if (retryable) {
      const requeued = await params.outbox.markFailedRetryable(
        claimed.id,
        category,
        code,
        claimed.attemptCount,
      );
      logEmailEvent("warn", "email.process.retry", {
        outboxId: requeued.id,
        tenantId: requeued.tenantId,
        templateKey: requeued.templateKey,
        attemptCount: requeued.attemptCount,
        errorCode: category,
      });
      return { outcome: "failed", record: requeued, retryable: true };
    }

    if (claimed.attemptCount >= claimed.maxAttempts) {
      const dead = await params.outbox.markDeadLetter(
        claimed.id,
        category,
        code,
        claimed.attemptCount,
      );
      logEmailEvent("warn", "email.process.dead_letter", {
        outboxId: dead.id,
        tenantId: dead.tenantId,
        templateKey: dead.templateKey,
        attemptCount: dead.attemptCount,
        errorCode: category,
      });
      return { outcome: "dead_letter", record: dead };
    }

    const failed = await params.outbox.markFailedTerminal(
      claimed.id,
      category,
      code,
      claimed.attemptCount,
    );
    logEmailEvent("warn", "email.process.failed", {
      outboxId: failed.id,
      tenantId: failed.tenantId,
      templateKey: failed.templateKey,
      attemptCount: failed.attemptCount,
      errorCode: category,
    });
    return { outcome: "failed", record: failed, retryable: false };
  }
}

export async function processQueuedEmailBatch(params: {
  outbox: EmailOutboxRepository;
  env: EmailEnv;
  provider?: EmailProvider;
  limit?: number;
}): Promise<ProcessEmailResult[]> {
  const queued = await params.outbox.listClaimable(params.limit ?? 10);
  const results: ProcessEmailResult[] = [];
  for (const record of queued) {
    results.push(
      await processEmailOutboxRecord({
        outboxId: record.id,
        outbox: params.outbox,
        env: params.env,
        provider: params.provider,
      }),
    );
  }
  return results;
}
