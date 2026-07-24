import type { ToolDefinition } from "../definition-schema";
import {
  PAYMENT_CREATE_ATTEMPT_INPUT_SCHEMA_ID,
  PAYMENT_CREATE_ATTEMPT_OUTPUT_SCHEMA_ID,
} from "../schemas/payment-create-attempt";

/** Contrat Production — 06 §12.2 */
export const paymentCreateAttemptV1: ToolDefinition = {
  tool_id: "payment.create_attempt",
  name: "Créer une tentative de paiement",
  version: "1.0.0",
  description:
    "Crée une tentative de paiement pour une facture existante (contrat technique ; pas de décision métier).",
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
    allowed_modes: ["agir", "conseiller", "transmettre"],
  },
  risk_level: "high",
  idempotency: {
    required: true,
    key_fields: ["invoice_id", "amount_cents", "currency", "attempt_version"],
    time_window_required: false,
    time_window_rationale:
      "attempt_version distinguishes each legitimate new attempt",
  },
  errors: [
    { code: "permission_denied", category: "permission", retryable: false },
    { code: "invalid_invoice_state", category: "business", retryable: false },
    { code: "provider_unavailable", category: "technical", retryable: true },
    { code: "duplicate_request", category: "business", retryable: false },
    { code: "unknown_result", category: "technical", retryable: false },
  ],
  retry_policy: {
    max_attempts: 3,
    backoff: "exponential",
    forbidden_when_unknown: true,
  },
  side_effects: ["create_payment_attempt_record"],
  sensitive_fields: ["amount_cents", "currency"],
  logging: {
    correlation_id_required: true,
    sensitive_fields_redacted: true,
  },
  timeout_ms: 30_000,
  status: "Production",
};
