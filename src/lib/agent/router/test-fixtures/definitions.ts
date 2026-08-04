/**
 * ToolDefinitions mémoire G1-D — Production / Approved / Deprecated / schémas manquants.
 */

import type { ToolDefinition } from "@/lib/agent/tools/definition-schema";
import { invoiceGetV1 } from "@/lib/agent/tools/definitions/invoice.get.1.0.0";
import { paymentCreateAttemptV09 } from "@/lib/agent/tools/definitions/payment.create_attempt.0.9.0";
import { paymentCreateAttemptV1 } from "@/lib/agent/tools/definitions/payment.create_attempt.1.0.0";
import {
  INVOICE_GET_INPUT_SCHEMA_ID,
  INVOICE_GET_OUTPUT_SCHEMA_ID,
} from "@/lib/agent/tools/schemas/invoice-get";
import {
  PAYMENT_CREATE_ATTEMPT_INPUT_SCHEMA_ID,
  PAYMENT_CREATE_ATTEMPT_OUTPUT_SCHEMA_ID,
} from "@/lib/agent/tools/schemas/payment-create-attempt";

import {
  MISSING_INPUT_SCHEMA_ID,
  MISSING_OUTPUT_SCHEMA_ID,
} from "./constants";

/** Outil lecture Production (schémas G1-B enregistrés). */
export const productionReadDefinition: ToolDefinition = invoiceGetV1;

/** Outil écriture Production (schémas G1-B enregistrés). */
export const productionWriteDefinition: ToolDefinition = paymentCreateAttemptV1;

/** Version Deprecated (EVAL-TOOL-020). */
export const deprecatedWriteDefinition: ToolDefinition = paymentCreateAttemptV09;

/** Outil Approved — connu mais non callable (status ≠ Production). */
export const approvedOnlyDefinition: ToolDefinition = {
  ...paymentCreateAttemptV1,
  tool_id: "fixture.router.approved_only",
  version: "1.0.0",
  name: "Fixture Approved only",
  description: "Outil Approved — non callable via Tool Router.",
  status: "Approved",
};

/** Production avec input_schema_id hors registre → INPUT_SCHEMA_UNRESOLVED. */
export const missingInputSchemaDefinition: ToolDefinition = {
  ...invoiceGetV1,
  tool_id: "fixture.router.missing_input_schema",
  version: "1.0.0",
  name: "Fixture missing input schema",
  description: "Définition Production dont le schéma d’entrée est introuvable.",
  input_schema_id: MISSING_INPUT_SCHEMA_ID,
  output_schema_id: INVOICE_GET_OUTPUT_SCHEMA_ID,
  status: "Production",
};

/** Production avec output_schema_id hors registre → OUTPUT_SCHEMA_UNRESOLVED. */
export const missingOutputSchemaDefinition: ToolDefinition = {
  ...invoiceGetV1,
  tool_id: "fixture.router.missing_output_schema",
  version: "1.0.0",
  name: "Fixture missing output schema",
  description: "Définition Production dont le schéma de sortie est introuvable.",
  input_schema_id: INVOICE_GET_INPUT_SCHEMA_ID,
  output_schema_id: MISSING_OUTPUT_SCHEMA_ID,
  status: "Production",
};

/**
 * Jeu mémoire standard pour le Router.
 * Inclut volontairement Approved / Deprecated / schémas manquants
 * (registre mémoire : pas d’assertSchemasRegistered à l’insertion).
 */
export const memoryDefinitions: ToolDefinition[] = [
  productionReadDefinition,
  productionWriteDefinition,
  deprecatedWriteDefinition,
  approvedOnlyDefinition,
  missingInputSchemaDefinition,
  missingOutputSchemaDefinition,
];

export const REGISTERED_INPUT_SCHEMA_IDS = [
  INVOICE_GET_INPUT_SCHEMA_ID,
  PAYMENT_CREATE_ATTEMPT_INPUT_SCHEMA_ID,
] as const;

export const REGISTERED_OUTPUT_SCHEMA_IDS = [
  INVOICE_GET_OUTPUT_SCHEMA_ID,
  PAYMENT_CREATE_ATTEMPT_OUTPUT_SCHEMA_ID,
] as const;
