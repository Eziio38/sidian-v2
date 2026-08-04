/**
 * G1-M — Conversation-to-Protection Draft.
 */

export type {
  AdvanceIntent,
  AmbiguityKind,
  AttachmentMeta,
  ConfirmCreateResult,
  DraftFieldName,
  DraftFields,
  DraftFieldValue,
  DraftRecap,
  FieldProvenance,
  OpenAmbiguity,
  OptionalDraftField,
  ProtectionDraftRecord,
  ProtectionDraftService,
  ProtectionDraftState,
  RequiredDraftField,
} from "./types";
export {
  CURRENCY_DEDUCTION_RULE,
  FIELD_PROVENANCES,
  OPTIONAL_DRAFT_FIELDS,
  PROTECTION_DRAFT_STATES,
  REQUIRED_DRAFT_FIELDS,
} from "./types";

export {
  PROTECTION_DRAFT_ERROR_CODES,
  ProtectionDraftError,
  isProtectionDraftError,
} from "./errors";
export type { ProtectionDraftErrorCode } from "./errors";

export { extractProtectionDraftFromMessage } from "./extraction";
export type { ExtractionResult } from "./extraction";

export {
  canAdvance,
  canConfirm,
  isTerminalState,
  nextStateAfterUpdate,
  stateAfterAcknowledgeRecap,
} from "./state-machine";

export {
  applyCorrection,
  buildRecap,
  buildTargetedQuestion,
  computeMissingFields,
  markFieldsConfirmed,
  mergeAttachments,
  mergeFields,
  resolveAmbiguityOnAnswer,
} from "./fields";

export type {
  ConfirmDraftParams,
  ConfirmDraftResult,
  ProtectionDraftRepository,
  UpsertDraftParams,
} from "./repository";

export {
  createProtectionDraftService,
  createSupabaseProtectionDraftService,
} from "./service";

export {
  createProtectionDraftExecutors,
  createProtectionDraftServiceExecutors,
} from "./executors";

export {
  createSupabaseProtectionDraftRepository,
} from "./supabase-repository";
export type {
  ProtectionDraftPersistenceClient,
} from "./supabase-repository";

export {
  canonicalizeDraftEmail,
  normalizeClientName,
  parseAmountEurosToMinor,
  validateAmountMinor,
  validateCurrency,
  validateIsoDate,
} from "./validation";
