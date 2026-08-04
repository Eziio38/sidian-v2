import type { ToolDefinition } from "../definition-schema";
import {
  PROTECTION_DRAFT_GET_INPUT_SCHEMA_ID,
  PROTECTION_DRAFT_GET_OUTPUT_SCHEMA_ID,
} from "../schemas/protection-draft";

/** G1-M — lecture d’un brouillon conversationnel. */
export const protectionDraftGetV1: ToolDefinition = {
  tool_id: "protection.draft.get",
  name: "Lire un brouillon de protection",
  version: "1.0.0",
  description:
    "Lit l’état et le récapitulatif d’un brouillon conversationnel (pas d’écriture métier).",
  category: "consultation",
  operation_type: "read",
  execution_mode: "synchronous",
  owner: "protection-draft",
  effect_family: "read_protection_draft",
  input_schema_id: PROTECTION_DRAFT_GET_INPUT_SCHEMA_ID,
  output_schema_id: PROTECTION_DRAFT_GET_OUTPUT_SCHEMA_ID,
  permissions: {
    required: ["protection.draft.read"],
    scope: ["tenant", "client", "receivable"],
  },
  autonomy: {
    maximum_level: 2,
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
    max_attempts: 0,
    backoff: "none",
    forbidden_when_unknown: true,
  },
  side_effects: [],
  sensitive_fields: ["client_email"],
  logging: {
    correlation_id_required: true,
    sensitive_fields_redacted: true,
  },
  timeout_ms: 10_000,
  status: "Production",
};
