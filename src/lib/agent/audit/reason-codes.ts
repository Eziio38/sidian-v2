/**
 * Codes de raison stables de l’Audit Service (G1-E).
 * Alignés sur G1-C (permissions) et G1-D (router) — sans doublons.
 * Jamais de chaîne de pensée LLM.
 */

import { PERMISSION_REASON_CODES } from "@/lib/agent/permissions/reason-codes";
import { ROUTER_ERROR_CODES } from "@/lib/agent/router/error-codes";

/** Succès d’appel d’outil audité. */
export const AUDIT_SUCCESS_REASON_CODE = "SUCCESS" as const;

/**
 * Ensemble dédupliqué : SUCCESS ∪ reason codes permissions ∪ error codes router.
 * `PERMISSION_DENIED` / `TOOL_NOT_CALLABLE` n’apparaissent qu’une fois.
 */
export const AUDIT_REASON_CODES = [
  AUDIT_SUCCESS_REASON_CODE,
  ...PERMISSION_REASON_CODES,
  ...ROUTER_ERROR_CODES.filter(
    (code) =>
      code !== "PERMISSION_DENIED" &&
      !(PERMISSION_REASON_CODES as readonly string[]).includes(code),
  ),
] as const;

export type AuditReasonCode = (typeof AUDIT_REASON_CODES)[number];

/** Code d’échec de construction d’événement (entrée invalide). */
export const AUDIT_BUILD_ERROR_CODES = [
  "AUDIT_INPUT_INVALID",
  "AUDIT_CONTEXT_INVALID",
] as const;

export type AuditBuildErrorCode = (typeof AUDIT_BUILD_ERROR_CODES)[number];
