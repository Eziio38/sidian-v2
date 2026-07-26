import type { ToolDefinition } from "../definition-schema";
import {
  PROTECTION_DRAFT_ADVANCE_INPUT_SCHEMA_ID,
  PROTECTION_DRAFT_ADVANCE_OUTPUT_SCHEMA_ID,
} from "../schemas/protection-draft";

/** G1-M — avance la machine conversationnelle (extraction / questions / récap). */
export const protectionDraftAdvanceV1: ToolDefinition = {
  tool_id: "protection.draft.advance",
  name: "Avancer un brouillon de protection",
  version: "1.0.0",
  description:
    "Extrait / corrige un brouillon conversationnel collaboration→protection. Aucune écriture métier (client/créance) avant confirmation.",
  category: "workflow",
  operation_type: "write",
  execution_mode: "synchronous",
  owner: "protection-draft",
  effect_family: "advance_protection_draft",
  input_schema_id: PROTECTION_DRAFT_ADVANCE_INPUT_SCHEMA_ID,
  output_schema_id: PROTECTION_DRAFT_ADVANCE_OUTPUT_SCHEMA_ID,
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
    key_fields: [],
    time_window_required: false,
  },
  errors: [
    { code: "permission_denied", category: "permission", retryable: false },
    { code: "invalid_argument", category: "business", retryable: false },
    { code: "draft_expired", category: "business", retryable: false },
  ],
  retry_policy: {
    max_attempts: 0,
    backoff: "none",
    forbidden_when_unknown: true,
  },
  side_effects: ["upsert_protection_draft_only"],
  sensitive_fields: ["client_email"],
  logging: {
    correlation_id_required: true,
    sensitive_fields_redacted: true,
  },
  timeout_ms: 15_000,
  status: "Production",
};
