/**
 * G1-N — Conversational Agent Runtime.
 *
 * Pipeline : message → LLM (provider) → schéma → domaine → protection.draft.*
 * Provider par défaut en tests/CI : stub (aucun appel réseau).
 */

export type {
  ConversationalRuntimeService,
  ConversationalTurnInput,
  ConversationalTurnResult,
  FieldConfidence,
  LlmFieldMap,
  LlmProvider,
  LlmProviderExtractInput,
  LlmStructuredExtraction,
  NormalizedExtraction,
  ParseUserMessageInput,
  ParseUserMessageResult,
  RuntimeTrace,
  ValidatedExtraction,
} from "./types";
export { CONVERSATIONAL_RUNTIME_SCHEMA_VERSION } from "./types";

export {
  CONVERSATIONAL_RUNTIME_ERROR_CODES,
  ConversationalRuntimeError,
  isConversationalRuntimeError,
} from "./errors";
export type { ConversationalRuntimeErrorCode } from "./errors";

export {
  llmStructuredExtractionSchema,
  MIN_FIELD_CONFIDENCE,
} from "./schemas";

export { parseUserMessage } from "./parse";
export { normalizeExtraction } from "./normalize";
export {
  computeAmbiguities,
  computeMissingFields,
  generateNextQuestion,
  generateSummary,
  validateExtraction,
} from "./domain";
export { applyUserCorrection, describeAfterCorrection } from "./corrections";
export { fallbackDeterministicExtraction } from "./fallback";
export { resolveRelativeDate, toReferenceDate } from "./relative-dates";
export {
  scanUserMessageForInjection,
  sanitizeMessageForProvider,
} from "./injection";
export { fingerprintMessage, toAuditableTracePayload } from "./trace";
export {
  createConversationalRuntimeService,
} from "./service";
export type { CreateConversationalRuntimeOptions } from "./service";

export {
  createStubLlmProvider,
  deterministicToLlmShape,
} from "./providers/stub-provider";
export type {
  StubLlmProvider,
  StubProviderBehavior,
} from "./providers/stub-provider";

export {
  createConversationalRuntimeExecutors,
  createConversationalRuntimeServiceExecutors,
} from "./executors";
