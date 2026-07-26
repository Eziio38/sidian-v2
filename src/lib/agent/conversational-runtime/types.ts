/**
 * G1-N — Conversational Agent Runtime — types domaine.
 *
 * Le LLM propose uniquement une extraction structurée.
 * Aucune écriture métier ; tenant/actor hors sortie modèle.
 */

import type {
  DraftFieldName,
  DraftFields,
  DraftRecap,
  OpenAmbiguity,
  ProtectionDraftRecord,
} from "@/lib/agent/protection-draft";

export const CONVERSATIONAL_RUNTIME_SCHEMA_VERSION =
  "conversational.extraction.v1" as const;

export type FieldConfidence = {
  value: string | number;
  /** 0..1 — confiance déclarée par le modèle (puis filtrée côté domaine). */
  confidence: number;
};

export type LlmFieldMap = Partial<
  Record<DraftFieldName, FieldConfidence | null>
>;

/**
 * Sortie brute attendue du provider LLM (avant validation métier).
 * Interdit : tenant_id, actor_id, confirm, send, payment, RPC.
 */
export type LlmStructuredExtraction = {
  schema_version: typeof CONVERSATIONAL_RUNTIME_SCHEMA_VERSION;
  fields: LlmFieldMap;
  ambiguities: OpenAmbiguity[];
  /** Notes modèle — jamais persistées. */
  model_notes?: string;
};

export type NormalizedExtraction = {
  fields: DraftFields;
  ambiguities: OpenAmbiguity[];
  field_confidence: Partial<Record<DraftFieldName, number>>;
  /** Champs rejetés (hallucination, hors schéma, confiance basse, etc.). */
  rejected_fields: Array<{
    field: DraftFieldName;
    reason: string;
  }>;
  source: "llm" | "deterministic_fallback";
};

export type ValidatedExtraction = {
  fields: DraftFields;
  ambiguities: OpenAmbiguity[];
  missing_fields: DraftFieldName[];
  field_confidence: Partial<Record<DraftFieldName, number>>;
  rejected_fields: NormalizedExtraction["rejected_fields"];
  source: NormalizedExtraction["source"];
};

export type RuntimeTrace = {
  /** Opaque — pas de prompt système, pas de JWT, pas de PII brute. */
  correlation_id: string;
  provider_id: string;
  source: NormalizedExtraction["source"];
  attempt: number;
  fallback_used: boolean;
  duration_ms: number;
  schema_ok: boolean;
  rejected_field_count: number;
  ambiguity_count: number;
  missing_field_count: number;
  /** Empreinte message (sha256 tronquée) — pas le texte brut. */
  message_fingerprint: string;
  error_code?: string;
};

export type ParseUserMessageInput = {
  user_message: string;
  /** Date de référence ISO-8601 (instant) pour résoudre les dates relatives. */
  reference_now: string;
  /** Résumé non sensible des champs déjà connus (pas d’e-mail complet si possible). */
  known_fields?: Partial<Record<DraftFieldName, string | number>>;
  timeout_ms?: number;
  max_retries?: number;
  correlation_id?: string;
};

export type ParseUserMessageResult = {
  extraction: ValidatedExtraction;
  next_question: string | null;
  summary: string;
  trace: RuntimeTrace;
};

export type ConversationalTurnInput = {
  tenant_id: string;
  actor_id: string;
  draft_id?: string;
  conversation_id?: string;
  /** Clé d’idempotence runtime (double envoi / rejeu). */
  idempotency_key?: string;
  user_message: string;
  reference_now: string;
  timeout_ms?: number;
  max_retries?: number;
  correlation_id?: string;
};

export type ConversationalTurnResult = {
  draft: ProtectionDraftRecord;
  recap: DraftRecap;
  targeted_question: string | null;
  summary: string;
  extraction: ValidatedExtraction;
  trace: RuntimeTrace;
  replay: boolean;
};

export type ConversationalRuntimeService = {
  parseUserMessage(input: ParseUserMessageInput): Promise<ParseUserMessageResult>;
  handleTurn(input: ConversationalTurnInput): Promise<ConversationalTurnResult>;
};

export type LlmProviderExtractInput = {
  user_message: string;
  /** Date civile de référence AAAA-MM-JJ (dérivée de reference_now). */
  reference_date: string;
  known_fields?: Partial<Record<DraftFieldName, string | number>>;
  signal?: AbortSignal;
};

export type LlmProvider = {
  readonly provider_id: string;
  extract(input: LlmProviderExtractInput): Promise<unknown>;
};
