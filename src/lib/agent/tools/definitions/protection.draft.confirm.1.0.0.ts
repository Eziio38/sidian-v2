import type { ToolDefinition } from "../definition-schema";
import {
  PROTECTION_DRAFT_CONFIRM_INPUT_SCHEMA_ID,
  PROTECTION_DRAFT_CONFIRM_OUTPUT_SCHEMA_ID,
} from "../schemas/protection-draft";

/**
 * G1-M — confirmation explicite → création atomique client_payeur + creance.
 * Aucun message client / WhatsApp / SMS / e-mail / prélèvement.
 */
export const protectionDraftConfirmV1: ToolDefinition = {
  tool_id: "protection.draft.confirm",
  name: "Confirmer et créer la protection",
  version: "1.0.0",
  description:
    "Après confirmation explicite, crée atomiquement et idempotemment le client et le paiement à recevoir (BROUILLON). Pas de communication client.",
  category: "financial",
  operation_type: "write",
  execution_mode: "synchronous",
  owner: "protection-draft",
  effect_family: "confirm_protection_draft",
  input_schema_id: PROTECTION_DRAFT_CONFIRM_INPUT_SCHEMA_ID,
  output_schema_id: PROTECTION_DRAFT_CONFIRM_OUTPUT_SCHEMA_ID,
  permissions: {
    required: ["protection.draft.confirm"],
    scope: ["tenant", "client", "receivable"],
  },
  autonomy: {
    maximum_level: 2,
    human_validation_required: false,
    allowed_modes: ["agir"],
  },
  risk_level: "high",
  idempotency: {
    required: true,
    key_fields: ["draft_id", "confirmation_nonce"],
    time_window_required: false,
  },
  errors: [
    { code: "permission_denied", category: "permission", retryable: false },
    { code: "confirmation_required", category: "business", retryable: false },
    { code: "draft_not_ready", category: "business", retryable: false },
    { code: "idempotency_conflict", category: "business", retryable: false },
  ],
  retry_policy: {
    max_attempts: 0,
    backoff: "none",
    forbidden_when_unknown: true,
  },
  side_effects: ["create_client_payeur", "create_creance_brouillon"],
  sensitive_fields: ["client_email", "expected_amount_minor"],
  logging: {
    correlation_id_required: true,
    sensitive_fields_redacted: true,
  },
  timeout_ms: 20_000,
  status: "Production",
};
