import type { ToolDefinition } from "../definition-schema";
import {
  PAYMENT_CREATE_ATTEMPT_INPUT_SCHEMA_ID,
  PAYMENT_CREATE_ATTEMPT_OUTPUT_SCHEMA_ID,
} from "../schemas/payment-create-attempt";

/** Ancienne version — statut Deprecated (EVAL-TOOL-020). */
export const paymentCreateAttemptV09: ToolDefinition = {
  tool_id: "payment.create_attempt",
  name: "Créer une tentative de paiement",
  version: "0.9.0",
  description: "Version dépréciée du contrat payment.create_attempt.",
  category: "financial",
  operation_type: "write",
  execution_mode: "asynchronous",
  owner: "payments",
  effect_family: "create_payment_attempt",
  input_schema_id: PAYMENT_CREATE_ATTEMPT_INPUT_SCHEMA_ID,
  output_schema_id: PAYMENT_CREATE_ATTEMPT_OUTPUT_SCHEMA_ID,
  permissions: {
    required: ["payment.execute"],
    scope: ["account", "invoice"],
  },
  autonomy: {
    maximum_level: 3,
    human_validation_required: true,
    allowed_modes: ["agir"],
  },
  risk_level: "high",
  idempotency: {
    required: true,
    key_fields: ["invoice_id", "amount_cents", "currency"],
    time_window_required: false,
  },
  errors: [
    { code: "permission_denied", category: "permission", retryable: false },
    { code: "unknown_result", category: "technical", retryable: false },
  ],
  retry_policy: {
    max_attempts: 1,
    backoff: "none",
    forbidden_when_unknown: true,
  },
  side_effects: ["create_payment_attempt_record"],
  sensitive_fields: ["amount_cents"],
  logging: {
    correlation_id_required: true,
    sensitive_fields_redacted: true,
  },
  timeout_ms: 30_000,
  status: "Deprecated",
  deprecation: {
    reason: "Remplacé par 1.0.0 (clé d’idempotence enrichie).",
    replacement_tool_id: "payment.create_attempt",
    replacement_version: "1.0.0",
    since: "2026-07-01",
  },
};
