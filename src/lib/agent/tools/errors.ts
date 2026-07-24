/**
 * Codes d’erreur du registre / validation de contrats (convention de contrat G1-B).
 * INVALID_ARGUMENT est une convention de schéma — pas la preuve runtime complète d’EVAL-TOOL-026.
 */

export type ToolErrorCategory = "technical" | "business" | "permission";

export type ToolRegistryErrorCode =
  | "TOOL_UNKNOWN"
  | "TOOL_VERSION_UNKNOWN"
  | "TOOL_DEPRECATED"
  | "TOOL_DISABLED"
  | "TOOL_NOT_CALLABLE"
  | "TOOL_DEFINITION_INVALID"
  | "SCHEMA_UNKNOWN"
  | "INVALID_ARGUMENT"
  | "SENSITIVE_DEFAULT_FORBIDDEN"
  | "PAYLOAD_NOT_MINIMAL";

export class ToolRegistryError extends Error {
  readonly code: ToolRegistryErrorCode;
  readonly category: ToolErrorCategory;
  readonly retryable: boolean;
  readonly userMessage: string;

  constructor(input: {
    code: ToolRegistryErrorCode;
    category: ToolErrorCategory;
    message: string;
    userMessage: string;
    retryable?: boolean;
  }) {
    super(input.message);
    this.name = "ToolRegistryError";
    this.code = input.code;
    this.category = input.category;
    this.userMessage = input.userMessage;
    this.retryable = input.retryable ?? false;
  }
}
