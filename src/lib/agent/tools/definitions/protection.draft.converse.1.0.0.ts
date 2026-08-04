import type { ToolDefinition } from "../definition-schema";
import {
  PROTECTION_DRAFT_CONVERSE_INPUT_SCHEMA_ID,
  PROTECTION_DRAFT_CONVERSE_OUTPUT_SCHEMA_ID,
} from "../schemas/protection-draft";

/**
 * G1-N — tour conversationnel LLM → brouillon via protection.draft (interne).
 * Aucune création métier ; confirm explicite toujours via protection.draft.confirm.
 */
export const protectionDraftConverseV1: ToolDefinition = {
  tool_id: "protection.draft.converse",
  name: "Tour conversationnel de protection",
  version: "1.0.0",
  description:
    "Interprète un message naturel (runtime LLM + validations) et met à jour uniquement un brouillon de protection. Jamais de création client/créance ni communication client.",
  category: "workflow",
  operation_type: "write",
  execution_mode: "synchronous",
  owner: "protection-draft",
  effect_family: "advance_protection_draft",
  input_schema_id: PROTECTION_DRAFT_CONVERSE_INPUT_SCHEMA_ID,
  output_schema_id: PROTECTION_DRAFT_CONVERSE_OUTPUT_SCHEMA_ID,
  permissions: {
    required: ["protection.draft.write"],
    scope: ["tenant", "client", "receivable"],
  },
  autonomy: {
    maximum_level: 2,
    human_validation_required: false,
    allowed_modes: ["agir", "conseiller"],
  },
  risk_level: "medium",
  idempotency: {
    required: false,
    key_fields: ["idempotency_key"],
    time_window_required: false,
  },
  errors: [
    { code: "permission_denied", category: "permission", retryable: false },
    { code: "invalid_argument", category: "business", retryable: false },
    { code: "provider_timeout", category: "technical", retryable: true },
  ],
  retry_policy: {
    max_attempts: 0,
    backoff: "none",
    forbidden_when_unknown: true,
  },
  side_effects: ["upsert_protection_draft_only"],
  sensitive_fields: ["client_email", "message"],
  logging: {
    correlation_id_required: true,
    sensitive_fields_redacted: true,
  },
  timeout_ms: 20_000,
  status: "Production",
};
