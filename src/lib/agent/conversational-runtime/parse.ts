/**
 * G1-N — parseUserMessage : provider → schéma → normalize → validate
 * avec timeout, retry limité et fallback déterministe.
 */

import { randomUUID } from "node:crypto";

import { ConversationalRuntimeError } from "./errors";
import { fallbackDeterministicExtraction } from "./fallback";
import {
  generateNextQuestion,
  generateSummary,
  validateExtraction,
} from "./domain";
import {
  sanitizeMessageForProvider,
  scanUserMessageForInjection,
} from "./injection";
import { normalizeExtraction } from "./normalize";
import { toReferenceDate } from "./relative-dates";
import { llmStructuredExtractionSchema } from "./schemas";
import { buildRuntimeTrace } from "./trace";
import type {
  LlmProvider,
  ParseUserMessageInput,
  ParseUserMessageResult,
  ValidatedExtraction,
} from "./types";

const DEFAULT_TIMEOUT_MS = 4_000;
const DEFAULT_MAX_RETRIES = 1;

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === "AbortError") ||
    (typeof DOMException !== "undefined" &&
      err instanceof DOMException &&
      err.name === "AbortError")
  );
}

async function withTimeout<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function fromFallback(
  message: string,
  referenceNow: string,
): ValidatedExtraction {
  return validateExtraction(
    fallbackDeterministicExtraction(message, referenceNow),
  );
}

export async function parseUserMessage(
  provider: LlmProvider,
  input: ParseUserMessageInput,
): Promise<ParseUserMessageResult> {
  const started = Date.now();
  const correlation_id = input.correlation_id ?? randomUUID();
  const timeout_ms = input.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const max_retries = input.max_retries ?? DEFAULT_MAX_RETRIES;
  const reference_date = toReferenceDate(input.reference_now);

  const injection = scanUserMessageForInjection(input.user_message);
  const sanitized = sanitizeMessageForProvider(input.user_message);

  let attempt = 0;
  let lastError: unknown;
  let schema_ok = false;
  let fallback_used = false;
  let extraction: ValidatedExtraction | null = null;

  const attemptsAllowed = 1 + Math.max(0, max_retries);

  while (attempt < attemptsAllowed) {
    attempt += 1;
    try {
      const raw = await withTimeout(timeout_ms, (signal) =>
        provider.extract({
          user_message: sanitized,
          reference_date,
          known_fields: input.known_fields,
          signal,
        }),
      );

      const parsed = llmStructuredExtractionSchema.safeParse(raw);
      if (!parsed.success) {
        lastError = new ConversationalRuntimeError(
          "CONVERSATIONAL_SCHEMA_INVALID",
          { message: "llm_output_off_schema" },
        );
        continue;
      }
      schema_ok = true;
      const normalized = normalizeExtraction(parsed.data, {
        user_message: input.user_message,
        reference_now: input.reference_now,
        reference_date,
      });
      extraction = validateExtraction(normalized);
      break;
    } catch (err) {
      lastError = err;
      if (isAbortError(err)) {
        lastError = new ConversationalRuntimeError(
          "CONVERSATIONAL_PROVIDER_TIMEOUT",
          { message: "provider_timeout" },
        );
      }
    }
  }

  if (!extraction) {
    fallback_used = true;
    extraction = fromFallback(input.user_message, input.reference_now);
  }

  // Les injections d’identité / contournement ne changent jamais tenant/actor
  // et n’autorisent jamais confirm — signal uniquement dans la summary si besoin.
  void injection;

  const result: ParseUserMessageResult = {
    extraction,
    next_question: generateNextQuestion(extraction),
    summary: generateSummary(extraction),
    trace: buildRuntimeTrace({
      correlation_id,
      provider_id: provider.provider_id,
      source: extraction.source,
      attempt,
      fallback_used,
      duration_ms: Date.now() - started,
      schema_ok: schema_ok || fallback_used,
      extraction,
      message: input.user_message,
      error_code:
        fallback_used && lastError instanceof ConversationalRuntimeError
          ? lastError.code
          : fallback_used
            ? "CONVERSATIONAL_PROVIDER_ERROR"
            : undefined,
    }),
  };

  return result;
}
