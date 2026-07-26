import type { ToolDefinition } from "../definition-schema";
import {
  PROTECTION_DRAFT_CANCEL_INPUT_SCHEMA_ID,
  PROTECTION_DRAFT_CANCEL_OUTPUT_SCHEMA_ID,
} from "../schemas/protection-draft";

/** G1-M — annulation d’un brouillon conversationnel. */
export const protectionDraftCancelV1: ToolDefinition = {
  tool_id: "protection.draft.cancel",
  name: "Annuler un brouillon de protection",
  version: "1.0.0",
  description:
    "Annule un brouillon conversationnel. Aucune création métier n’est effectuée.",
  category: "workflow",
  operation_type: "write",
  execution_mode: "synchronous",
  owner: "protection-draft",
  effect_family: "cancel_protection_draft",
  input_schema_id: PROTECTION_DRAFT_CANCEL_INPUT_SCHEMA_ID,
  output_schema_id: PROTECTION_DRAFT_CANCEL_OUTPUT_SCHEMA_ID,
  permissions: {
    required: ["protection.draft.write"],
    scope: ["tenant"],
  },
  autonomy: {
    maximum_level: 2,
    human_validation_required: false,
    allowed_modes: ["agir"],
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
    max_attempts: 0,
    backoff: "none",
    forbidden_when_unknown: true,
  },
  side_effects: ["cancel_protection_draft"],
  sensitive_fields: [],
  logging: {
    correlation_id_required: true,
    sensitive_fields_redacted: true,
  },
  timeout_ms: 10_000,
  status: "Production",
};
