import {
  canonicalizeEmailAddress,
  canonicalizeOptionalDisplayName,
  hashEmailAddress,
} from "../address";
import type { EmailEnv } from "../env";
import { EmailError } from "../errors";
import { buildEmailIdempotencyKey } from "../idempotency";
import { logEmailEvent } from "../log";
import {
  renderEmailTemplate,
  type TemplateVariablesByKey,
} from "../templates/registry";
import type {
  EmailLocale,
  EmailOutboxRecord,
  EmailProviderKind,
  EmailRelatedEntityType,
  EmailTemplateKey,
} from "../types";
import { EMAIL_MAX_SEND_ATTEMPTS } from "../types";
import type { EmailOutboxRepository } from "./repository";

export type EnqueueEmailInput<K extends EmailTemplateKey = EmailTemplateKey> = {
  tenantId: string;
  templateKey: K;
  locale?: EmailLocale;
  recipient: {
    email: string;
    name?: string;
  };
  variables: TemplateVariablesByKey[K];
  relatedEntityType?: EmailRelatedEntityType;
  relatedEntityId?: string;
  /**
   * Occurrence métier (ex. date ISO du scanner, id tentative).
   * Requis pour construire l'idempotence si idempotencyKey absente.
   */
  occurrenceKey?: string;
  /** Si fournie, utilisée telle quelle (8–256 chars). */
  idempotencyKey?: string;
  maxAttempts?: number;
};

export type EmailOutboxService = {
  enqueue<K extends EmailTemplateKey>(
    input: EnqueueEmailInput<K>,
  ): Promise<EmailOutboxRecord>;
};

function resolveProviderKind(env: EmailEnv): EmailProviderKind {
  if (env.mode === "stub") return "stub";
  return "resend";
}

/**
 * Enregistre une intention d'envoi (queued) sans appeler le fournisseur.
 * Corps HTML + text rendus au enqueue (snapshot déterministe).
 */
export function createEmailOutboxService(deps: {
  outbox: EmailOutboxRepository;
  env: EmailEnv;
}): EmailOutboxService {
  return {
    async enqueue(input) {
      if (!input.tenantId.trim()) {
        throw new EmailError("email_enqueue_rejected", "tenant_required");
      }

      const recipientEmail = canonicalizeEmailAddress(input.recipient.email);
      const recipientName =
        canonicalizeOptionalDisplayName(input.recipient.name) ?? null;
      const recipientEmailHash = hashEmailAddress(recipientEmail);
      const locale = input.locale ?? "fr";

      const rendered = renderEmailTemplate({
        templateKey: input.templateKey,
        locale,
        variables: input.variables,
      });

      const entityId =
        input.relatedEntityId?.trim() ||
        input.occurrenceKey?.trim() ||
        recipientEmailHash;

      const idempotencyKey =
        input.idempotencyKey?.trim() ||
        buildEmailIdempotencyKey({
          tenantId: input.tenantId,
          templateKey: input.templateKey,
          entityId,
          occurrenceKey:
            input.occurrenceKey?.trim() ||
            input.relatedEntityId?.trim() ||
            "default",
          recipientEmailHash,
        });

      if (idempotencyKey.length < 8 || idempotencyKey.length > 256) {
        throw new EmailError("email_enqueue_rejected", "idempotency_key_invalid");
      }

      const existing = await deps.outbox.findByIdempotencyKey(
        input.tenantId,
        idempotencyKey,
      );
      if (existing) {
        logEmailEvent("info", "email.enqueue.idempotent_hit", {
          outboxId: existing.id,
          tenantId: existing.tenantId,
          templateKey: existing.templateKey,
          status: existing.status,
          recipientEmailHash: existing.recipientEmailHash,
        });
        return existing;
      }

      const providerKind = resolveProviderKind(deps.env);
      const record = await deps.outbox.insertQueued({
        tenantId: input.tenantId,
        templateKey: input.templateKey,
        templateLocale: locale,
        recipientEmail,
        recipientName,
        recipientEmailHash,
        subject: rendered.subject,
        bodyText: rendered.text,
        bodyHtml: rendered.html,
        variablesSnapshot: {
          ...(input.variables as Record<string, unknown>),
        },
        relatedEntityType: input.relatedEntityType ?? null,
        relatedEntityId: input.relatedEntityId ?? null,
        idempotencyKey,
        providerKind,
        maxAttempts: input.maxAttempts ?? EMAIL_MAX_SEND_ATTEMPTS,
      });

      logEmailEvent("info", "email.enqueue.queued", {
        outboxId: record.id,
        tenantId: record.tenantId,
        templateKey: record.templateKey,
        status: record.status,
        recipientEmailHash: record.recipientEmailHash,
        providerKind: record.providerKind,
      });

      return record;
    },
  };
}
