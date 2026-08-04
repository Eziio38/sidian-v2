/**
 * Fixtures de test uniquement — jamais chargées par loadProductionRegistry().
 */

import type { ToolDefinition } from "../definition-schema";
import {
  PAYMENT_CREATE_ATTEMPT_INPUT_SCHEMA_ID,
  PAYMENT_CREATE_ATTEMPT_OUTPUT_SCHEMA_ID,
} from "../schemas/payment-create-attempt";

const basePayment = {
  name: "fixture",
  version: "1.0.0",
  description: "fixture",
  category: "financial" as const,
  operation_type: "write" as const,
  execution_mode: "asynchronous" as const,
  owner: "test",
  effect_family: "create_payment_attempt" as const,
  input_schema_id: PAYMENT_CREATE_ATTEMPT_INPUT_SCHEMA_ID,
  output_schema_id: PAYMENT_CREATE_ATTEMPT_OUTPUT_SCHEMA_ID,
  permissions: {
    required: ["payment.execute"],
    scope: ["account", "invoice"] as Array<"account" | "invoice">,
  },
  autonomy: {
    maximum_level: 3 as const,
    human_validation_required: true,
    allowed_modes: ["agir"] as Array<"agir">,
  },
  risk_level: "high" as const,
  idempotency: {
    required: true,
    key_fields: ["invoice_id"],
    time_window_required: false,
  },
  errors: [
    { code: "permission_denied", category: "permission" as const, retryable: false },
  ],
  retry_policy: {
    max_attempts: 0,
    backoff: "none" as const,
    forbidden_when_unknown: true as const,
  },
  side_effects: [] as string[],
  sensitive_fields: [] as string[],
  logging: {
    correlation_id_required: true as const,
    sensitive_fields_redacted: true as const,
  },
  timeout_ms: 1000,
};

/** Fiche incomplète (EVAL-DOC-008) — champs critiques omis. */
export const incompleteToolFiche = {
  tool_id: "fixture.incomplete",
  name: "Incomplet",
  version: "1.0.0",
  // description manquante, autonomy manquante, idempotency manquante…
};

/** Outil multi-préoccupations via famille interdite composite (EVAL-TOOL-001). */
export const godToolAttempt = {
  ...basePayment,
  tool_id: "fixture.god_tool",
  effect_family: "read_and_pay_and_email",
  status: "Production" as const,
};

/** Décision métier structurellement interdite (EVAL-TOOL-027). */
export const approveRefundToolAttempt = {
  ...basePayment,
  tool_id: "fixture.approve_refund",
  effect_family: "approve",
  status: "Production" as const,
};

export const decideToolAttempt = {
  ...basePayment,
  tool_id: "fixture.decide",
  effect_family: "decide",
  status: "Production" as const,
};

/** Disabled — pour EVAL-TOOL-020 via registre de test. */
export const disabledPaymentTool: ToolDefinition = {
  ...basePayment,
  tool_id: "fixture.disabled_payment",
  status: "Disabled",
};

/** Approved mais non callable (G1-B). */
export const approvedOnlyTool: ToolDefinition = {
  ...basePayment,
  tool_id: "fixture.approved_only",
  status: "Approved",
};

/** Schéma inexistant — doit échouer au chargement. */
export const unknownSchemaTool = {
  ...basePayment,
  tool_id: "fixture.unknown_schema",
  input_schema_id: "does.not.exist.input",
  output_schema_id: PAYMENT_CREATE_ATTEMPT_OUTPUT_SCHEMA_ID,
  status: "Production" as const,
};
