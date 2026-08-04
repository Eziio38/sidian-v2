import type { ZodType } from "zod";

import type { ToolDefinition } from "./definition-schema";
import { ToolRegistryError } from "./errors";
import { getSchemaById } from "./schema-registry";
import {
  toolCallEnvelopeSchema,
  type ToolCallEnvelope,
} from "./schemas/common";
import { assertNotificationDraftPayloadMinimal } from "./schemas/notification-generate-draft";

export type ArgumentValidationSuccess<T> = {
  ok: true;
  envelope: ToolCallEnvelope;
  arguments: T;
};

export type ArgumentValidationFailure = {
  ok: false;
  error: ToolRegistryError;
};

/**
 * Valide l’enveloppe commune puis les arguments métier via le schema-registry.
 * Aucun effet de bord.
 */
export function validateToolCallArguments(
  definition: ToolDefinition,
  rawEnvelope: unknown,
): ArgumentValidationSuccess<unknown> | ArgumentValidationFailure {
  const envelopeParsed = toolCallEnvelopeSchema.safeParse(rawEnvelope);
  if (!envelopeParsed.success) {
    return {
      ok: false,
      error: new ToolRegistryError({
        code: "INVALID_ARGUMENT",
        category: "business",
        message: envelopeParsed.error.message,
        userMessage: "La demande d’outil est mal formée.",
      }),
    };
  }

  const envelope = envelopeParsed.data;
  if (envelope.tool_id !== definition.tool_id) {
    return {
      ok: false,
      error: new ToolRegistryError({
        code: "INVALID_ARGUMENT",
        category: "business",
        message: "tool_id enveloppe ≠ définition",
        userMessage: "La demande d’outil est incohérente.",
      }),
    };
  }
  if (envelope.tool_version !== definition.version) {
    return {
      ok: false,
      error: new ToolRegistryError({
        code: "INVALID_ARGUMENT",
        category: "business",
        message: "tool_version enveloppe ≠ définition",
        userMessage: "La version d’outil est incohérente.",
      }),
    };
  }

  // human_validation_id ne doit pas apparaître dans arguments métier
  if (
    envelope.arguments &&
    Object.prototype.hasOwnProperty.call(
      envelope.arguments,
      "human_validation_id",
    )
  ) {
    return {
      ok: false,
      error: new ToolRegistryError({
        code: "INVALID_ARGUMENT",
        category: "business",
        message: "human_validation_id interdit dans arguments métier",
        userMessage: "La demande d’outil est mal formée.",
      }),
    };
  }

  if (definition.tool_id === "notification.generate_draft") {
    try {
      assertNotificationDraftPayloadMinimal(
        envelope.arguments as Record<string, unknown>,
      );
    } catch {
      return {
        ok: false,
        error: new ToolRegistryError({
          code: "PAYLOAD_NOT_MINIMAL",
          category: "business",
          message: "Payload notification contient des données comptables",
          userMessage: "Trop de données pour cette notification.",
        }),
      };
    }
  }

  let inputSchema: ZodType;
  try {
    inputSchema = getSchemaById(definition.input_schema_id);
  } catch (error) {
    if (error instanceof ToolRegistryError) {
      return { ok: false, error };
    }
    throw error;
  }

  const argsParsed = inputSchema.safeParse(envelope.arguments);
  if (!argsParsed.success) {
    const issue = argsParsed.error.issues[0];
    const missing =
      issue?.code === "invalid_type" &&
      (issue as { received?: string }).received === "undefined";
    return {
      ok: false,
      error: new ToolRegistryError({
        code: missing ? "INVALID_ARGUMENT" : "INVALID_ARGUMENT",
        category: "business",
        message: argsParsed.error.message,
        userMessage: missing
          ? "Un paramètre obligatoire est manquant."
          : "Un paramètre est invalide.",
      }),
    };
  }

  return {
    ok: true,
    envelope,
    arguments: argsParsed.data,
  };
}
