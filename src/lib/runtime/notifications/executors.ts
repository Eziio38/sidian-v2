/**
 * Exécuteurs Tool Router — invoice.get + notification.generate_draft.
 * Tenant uniquement depuis ToolExecutorInput (TrustedExecutionContext).
 */

import type {
  ResolveToolExecutor,
  ToolExecutor,
  ToolExecutorInput,
} from "@/lib/agent/router/executor";
import { ToolExecutorError } from "@/lib/agent/router/executor";

import {
  isNotificationRuntimeError,
  type NotificationRuntimeError,
} from "./errors";
import type { InvoiceGetService } from "./invoice-get";
import type { NotificationDraftService } from "./notification-draft";

function toExecutorError(err: unknown): ToolExecutorError {
  if (isNotificationRuntimeError(err)) {
    return mapRuntimeError(err);
  }
  return new ToolExecutorError({
    category: "technical",
    code: "NOTIFICATION_RUNTIME_UNAVAILABLE",
    message: "notification_runtime_executor_failed",
    userMessage: "Le service de notification est indisponible.",
  });
}

function mapRuntimeError(err: NotificationRuntimeError): ToolExecutorError {
  return new ToolExecutorError({
    category: err.category,
    code: err.code,
    message: err.message,
    userMessage: err.userMessage,
  });
}

export function createNotificationRuntimeExecutors(deps: {
  invoiceGet: InvoiceGetService;
  notificationDraft: NotificationDraftService;
}): ResolveToolExecutor {
  const invoiceGetExecutor: ToolExecutor = {
    async execute(input: ToolExecutorInput) {
      try {
        const args = input.arguments as { invoice_id: string };
        return await deps.invoiceGet.get({
          tenantId: input.tenant.tenant_id,
          invoiceId: args.invoice_id,
        });
      } catch (err) {
        throw toExecutorError(err);
      }
    },
  };

  const draftExecutor: ToolExecutor = {
    async execute(input: ToolExecutorInput) {
      try {
        const args = input.arguments as {
          invoice_id: string;
          template_id: string;
          locale?: string;
        };
        return await deps.notificationDraft.generateDraft({
          tenantId: input.tenant.tenant_id,
          invoiceId: args.invoice_id,
          templateId: args.template_id,
          locale: args.locale,
        });
      } catch (err) {
        throw toExecutorError(err);
      }
    },
  };

  return (toolId, version) => {
    if (version !== "1.0.0") return undefined;
    switch (toolId) {
      case "invoice.get":
        return invoiceGetExecutor;
      case "notification.generate_draft":
        return draftExecutor;
      default:
        return undefined;
    }
  };
}
