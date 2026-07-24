import type { ToolDefinition } from "../definition-schema";
import {
  INVOICE_GET_INPUT_SCHEMA_ID,
  INVOICE_GET_OUTPUT_SCHEMA_ID,
} from "../schemas/invoice-get";

/** Contrat Production — consultation facture (06 §11.1). */
export const invoiceGetV1: ToolDefinition = {
  tool_id: "invoice.get",
  name: "Lire une facture",
  version: "1.0.0",
  description: "Lecture minimale d’une facture du tenant (pas de décision métier).",
  category: "consultation",
  operation_type: "read",
  execution_mode: "synchronous",
  owner: "receivables",
  effect_family: "read_invoice",
  input_schema_id: INVOICE_GET_INPUT_SCHEMA_ID,
  output_schema_id: INVOICE_GET_OUTPUT_SCHEMA_ID,
  permissions: {
    required: ["invoice.read"],
    scope: ["account", "invoice"],
  },
  autonomy: {
    maximum_level: 1,
    human_validation_required: false,
    allowed_modes: ["agir", "conseiller", "transmettre"],
  },
  risk_level: "low",
  idempotency: {
    required: false,
    key_fields: [],
    time_window_required: false,
  },
  errors: [
    { code: "permission_denied", category: "permission", retryable: false },
    { code: "not_found", category: "business", retryable: false },
  ],
  retry_policy: {
    max_attempts: 2,
    backoff: "fixed",
    forbidden_when_unknown: true,
  },
  side_effects: [],
  sensitive_fields: [],
  logging: {
    correlation_id_required: true,
    sensitive_fields_redacted: true,
  },
  timeout_ms: 5_000,
  status: "Production",
};
