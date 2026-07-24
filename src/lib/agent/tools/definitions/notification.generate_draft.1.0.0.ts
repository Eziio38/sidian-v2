import type { ToolDefinition } from "../definition-schema";
import {
  NOTIFICATION_GENERATE_DRAFT_INPUT_SCHEMA_ID,
  NOTIFICATION_GENERATE_DRAFT_OUTPUT_SCHEMA_ID,
} from "../schemas/notification-generate-draft";

/** Contrat Production — brouillon de notification (06 §11.2). */
export const notificationGenerateDraftV1: ToolDefinition = {
  tool_id: "notification.generate_draft",
  name: "Générer un brouillon de notification",
  version: "1.0.0",
  description:
    "Prépare un brouillon de notification à partir d’identifiants minimaux (pas d’envoi, pas de dump comptable).",
  category: "communication",
  operation_type: "write",
  execution_mode: "synchronous",
  owner: "communications",
  effect_family: "generate_notification_draft",
  input_schema_id: NOTIFICATION_GENERATE_DRAFT_INPUT_SCHEMA_ID,
  output_schema_id: NOTIFICATION_GENERATE_DRAFT_OUTPUT_SCHEMA_ID,
  permissions: {
    required: ["notification.draft"],
    scope: ["account", "invoice"],
  },
  autonomy: {
    maximum_level: 2,
    human_validation_required: false,
    allowed_modes: ["agir", "conseiller", "transmettre"],
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
  ],
  retry_policy: {
    max_attempts: 0,
    backoff: "none",
    forbidden_when_unknown: true,
  },
  side_effects: ["create_draft_only"],
  sensitive_fields: [],
  logging: {
    correlation_id_required: true,
    sensitive_fields_redacted: true,
  },
  timeout_ms: 10_000,
  status: "Production",
};
