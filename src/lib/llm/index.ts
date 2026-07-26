/**
 * SIDIAN LLM Runtime (P0)
 *
 * Provider texte pour usages autorisés uniquement :
 * assistant / extraction structurée brouillon / assistance / génération sûre.
 *
 * Interdit : décisions paiement, débits, mutations financières autonomes,
 * contournement permissions, exposition d’outils financiers.
 */

export {
  LLM_ERROR_CODES,
  LlmError,
  isLlmError,
} from "./errors";
export type { LlmErrorCode, LlmErrorCategory } from "./errors";

export {
  LLM_ALLOWED_PURPOSES,
  LLM_FORBIDDEN_INTENTS,
  LLM_FORBIDDEN_TOOL_NAME_PATTERNS,
  LLM_SAFETY_BOUNDARIES,
  findForbiddenToolNames,
  isAllowedPurpose,
  isForbiddenIntent,
  isForbiddenToolName,
} from "./safety";
export type { LlmAllowedPurpose, LlmForbiddenIntent } from "./safety";

export {
  loadLlmEnv,
  isLlmProviderEnabled,
  LLM_TRANSPORT_MODES,
} from "./env";
export type { LlmEnv, LlmEnvTransportMode } from "./env";

export type {
  LlmTransportMode,
  LlmMessage,
  LlmMessageRole,
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmTokenUsage,
  LlmTransport,
  LlmRuntime,
  LlmObservabilityEvent,
  LlmObservabilitySink,
} from "./types";

export {
  redactText,
  redactSensitive,
  sanitizeUserContentForModel,
  REDACTED,
} from "./redaction";

export {
  createLlmBudgetTracker,
} from "./budget";
export type { LlmBudgetLimits, LlmBudgetTracker } from "./budget";

export {
  buildLlmObservabilityEvent,
  fingerprintMessages,
  fingerprintOpaque,
  InMemoryLlmObservabilitySink,
  NullLlmObservabilitySink,
} from "./observability";

export { createStubLlmTransport } from "./providers/stub";
export type { StubLlmTransportOptions } from "./providers/stub";

export { createOpenAiCompatibleTransport } from "./providers/openai-compatible";
export type { OpenAiCompatibleTransportConfig } from "./providers/openai-compatible";

export { createLlmRuntime } from "./runtime";
export type { CreateLlmRuntimeOptions } from "./runtime";

export { createLlmRuntimeFromEnv } from "./factory";
export type { CreateLlmRuntimeFromEnvOptions } from "./factory";

export {
  createConversationalExtractProvider,
  deterministicExtractionShape,
} from "./adapters/conversational-extract";
export type { ConversationalExtractProviderOptions } from "./adapters/conversational-extract";

export { resolveConversationalLlmProvider } from "./resolve-conversational-provider";
export type { ResolveConversationalLlmProviderOptions } from "./resolve-conversational-provider";
