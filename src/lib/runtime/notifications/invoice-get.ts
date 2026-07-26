/**
 * invoice.get — consultation minimale d’une créance (alias invoice_id).
 *
 * Hors scope : émission légale, sync Pennylane, export comptable (02 §8, 01 §6).
 */

import {
  NotificationRuntimeError,
} from "./errors";
import type { CreanceLookup, InvoiceGetResult } from "./types";

export type InvoiceGetService = {
  get(input: {
    tenantId: string;
    invoiceId: string;
  }): Promise<InvoiceGetResult>;
};

export function createInvoiceGetService(
  lookup: CreanceLookup,
): InvoiceGetService {
  return {
    async get(input) {
      const invoiceId = input.invoiceId?.trim() ?? "";
      if (!invoiceId) {
        throw new NotificationRuntimeError({
          category: "business",
          code: "INVALID_ARGUMENT",
          message: "invoice_id_required",
          userMessage: "Identifiant de paiement à recevoir manquant.",
        });
      }

      let snapshot;
      try {
        snapshot = await lookup.findById(input.tenantId, invoiceId);
      } catch {
        throw new NotificationRuntimeError({
          category: "technical",
          code: "NOTIFICATION_RUNTIME_UNAVAILABLE",
          message: "creance_lookup_failed",
          userMessage: "La consultation est temporairement indisponible.",
        });
      }

      if (!snapshot) {
        throw new NotificationRuntimeError({
          category: "business",
          code: "INVOICE_NOT_FOUND",
          message: "creance_not_found",
          userMessage: "Paiement à recevoir introuvable.",
        });
      }

      return {
        invoice_id: snapshot.id,
        amount_cents: snapshot.amountCents,
        currency: "EUR",
        status: snapshot.status,
      };
    },
  };
}
