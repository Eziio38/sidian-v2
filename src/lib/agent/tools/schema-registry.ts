import type { ZodType } from "zod";

import { ToolRegistryError } from "./errors";
import {
  INVOICE_GET_INPUT_SCHEMA_ID,
  INVOICE_GET_OUTPUT_SCHEMA_ID,
  invoiceGetInputSchema,
  invoiceGetOutputSchema,
} from "./schemas/invoice-get";
import {
  NOTIFICATION_GENERATE_DRAFT_INPUT_SCHEMA_ID,
  NOTIFICATION_GENERATE_DRAFT_OUTPUT_SCHEMA_ID,
  notificationGenerateDraftInputSchema,
  notificationGenerateDraftOutputSchema,
} from "./schemas/notification-generate-draft";
import {
  PAYMENT_CREATE_ATTEMPT_INPUT_SCHEMA_ID,
  PAYMENT_CREATE_ATTEMPT_OUTPUT_SCHEMA_ID,
  paymentCreateAttemptInputSchema,
  paymentCreateAttemptOutputSchema,
} from "./schemas/payment-create-attempt";
import {
  PROTECTION_DRAFT_ADVANCE_INPUT_SCHEMA_ID,
  PROTECTION_DRAFT_ADVANCE_OUTPUT_SCHEMA_ID,
  PROTECTION_DRAFT_CANCEL_INPUT_SCHEMA_ID,
  PROTECTION_DRAFT_CANCEL_OUTPUT_SCHEMA_ID,
  PROTECTION_DRAFT_CONFIRM_INPUT_SCHEMA_ID,
  PROTECTION_DRAFT_CONFIRM_OUTPUT_SCHEMA_ID,
  PROTECTION_DRAFT_CONVERSE_INPUT_SCHEMA_ID,
  PROTECTION_DRAFT_CONVERSE_OUTPUT_SCHEMA_ID,
  PROTECTION_DRAFT_GET_INPUT_SCHEMA_ID,
  PROTECTION_DRAFT_GET_OUTPUT_SCHEMA_ID,
  protectionDraftAdvanceInputSchema,
  protectionDraftAdvanceOutputSchema,
  protectionDraftCancelInputSchema,
  protectionDraftCancelOutputSchema,
  protectionDraftConfirmInputSchema,
  protectionDraftConfirmOutputSchema,
  protectionDraftConverseInputSchema,
  protectionDraftConverseOutputSchema,
  protectionDraftGetInputSchema,
  protectionDraftGetOutputSchema,
} from "./schemas/protection-draft";

const schemaMap: Record<string, ZodType> = {
  [PAYMENT_CREATE_ATTEMPT_INPUT_SCHEMA_ID]: paymentCreateAttemptInputSchema,
  [PAYMENT_CREATE_ATTEMPT_OUTPUT_SCHEMA_ID]: paymentCreateAttemptOutputSchema,
  [INVOICE_GET_INPUT_SCHEMA_ID]: invoiceGetInputSchema,
  [INVOICE_GET_OUTPUT_SCHEMA_ID]: invoiceGetOutputSchema,
  [NOTIFICATION_GENERATE_DRAFT_INPUT_SCHEMA_ID]:
    notificationGenerateDraftInputSchema,
  [NOTIFICATION_GENERATE_DRAFT_OUTPUT_SCHEMA_ID]:
    notificationGenerateDraftOutputSchema,
  [PROTECTION_DRAFT_ADVANCE_INPUT_SCHEMA_ID]: protectionDraftAdvanceInputSchema,
  [PROTECTION_DRAFT_ADVANCE_OUTPUT_SCHEMA_ID]:
    protectionDraftAdvanceOutputSchema,
  [PROTECTION_DRAFT_GET_INPUT_SCHEMA_ID]: protectionDraftGetInputSchema,
  [PROTECTION_DRAFT_GET_OUTPUT_SCHEMA_ID]: protectionDraftGetOutputSchema,
  [PROTECTION_DRAFT_CANCEL_INPUT_SCHEMA_ID]: protectionDraftCancelInputSchema,
  [PROTECTION_DRAFT_CANCEL_OUTPUT_SCHEMA_ID]: protectionDraftCancelOutputSchema,
  [PROTECTION_DRAFT_CONFIRM_INPUT_SCHEMA_ID]: protectionDraftConfirmInputSchema,
  [PROTECTION_DRAFT_CONFIRM_OUTPUT_SCHEMA_ID]:
    protectionDraftConfirmOutputSchema,
  [PROTECTION_DRAFT_CONVERSE_INPUT_SCHEMA_ID]:
    protectionDraftConverseInputSchema,
  [PROTECTION_DRAFT_CONVERSE_OUTPUT_SCHEMA_ID]:
    protectionDraftConverseOutputSchema,
};

export function getSchemaById(schemaId: string): ZodType {
  const schema = schemaMap[schemaId];
  if (!schema) {
    throw new ToolRegistryError({
      code: "SCHEMA_UNKNOWN",
      category: "technical",
      message: `Schéma inconnu: ${schemaId}`,
      userMessage: "Le contrat d’outil est incomplet.",
    });
  }
  return schema;
}

export function assertSchemasRegistered(
  inputSchemaId: string,
  outputSchemaId: string,
): void {
  getSchemaById(inputSchemaId);
  getSchemaById(outputSchemaId);
}

export function listRegisteredSchemaIds(): string[] {
  return Object.keys(schemaMap).sort();
}
