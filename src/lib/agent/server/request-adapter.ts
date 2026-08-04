/**
 * Adaptation HTTP → ExternalToolRequest (G1-L).
 *
 * Pipeline pré-Gateway :
 * method → Content-Type → size limit → parse JSON once → schéma G1-K.
 *
 * Aucune confiance tenant/actor/token depuis le body.
 * Aucune construction de TrustedExecutionContext ici.
 */

import {
  externalToolRequestSchema,
  type ExternalToolRequest,
  type ParsedExternalToolRequest,
} from "@/lib/agent/gateway";

import { AgentServerError } from "./errors";
import type { AgentServerLimits } from "./limits";

/** Méthodes HTTP autorisées pour le point d’entrée agent. */
export const AGENT_SERVER_ALLOWED_METHODS = ["POST"] as const;

export type AgentServerAllowedMethod =
  (typeof AGENT_SERVER_ALLOWED_METHODS)[number];

const JSON_CONTENT_TYPE_RE = /^application\/json(?:\s*;.*)?$/i;

export type ParsedAgentServerBody = {
  externalRequest: ParsedExternalToolRequest;
  /** Corps brut UTF-8 — jamais muté après lecture. */
  rawBodyText: string;
  /** Octets lus (après borne). */
  bodyByteLength: number;
};

/**
 * Refuse toute méthode hors allowlist (typiquement hors POST).
 */
export function assertAllowedMethod(method: string): void {
  const normalized = method.toUpperCase();
  if (
    !(AGENT_SERVER_ALLOWED_METHODS as readonly string[]).includes(normalized)
  ) {
    throw new AgentServerError("HTTP_METHOD_NOT_ALLOWED", 405);
  }
}

/**
 * Vérifie Content-Type : requis + `application/json` (charset optionnel).
 */
export function assertJsonContentType(
  contentType: string | null | undefined,
): void {
  const raw = contentType?.trim();
  if (!raw) {
    throw new AgentServerError("HTTP_CONTENT_TYPE_REQUIRED", 415);
  }
  if (!JSON_CONTENT_TYPE_RE.test(raw)) {
    throw new AgentServerError("HTTP_CONTENT_TYPE_UNSUPPORTED", 415);
  }
}

/**
 * Refuse un `Content-Length` déclaré au-delà de `max_body_bytes`.
 * Ne remplace pas la borne à la lecture streaming.
 */
export function assertDeclaredBodyLength(
  headers: Headers,
  limits: Pick<AgentServerLimits, "max_body_bytes">,
): void {
  const declared = headers.get("content-length");
  if (declared === null || declared.trim() === "") {
    return;
  }
  const length = Number(declared);
  if (!Number.isFinite(length) || length < 0) {
    throw new AgentServerError("HTTP_BODY_INVALID", 400);
  }
  if (length > limits.max_body_bytes) {
    throw new AgentServerError("HTTP_BODY_TOO_LARGE", 413);
  }
}

/**
 * Lit le corps avec borne stricte — annule le reader si trop volumineux.
 * Une seule lecture : le caller ne doit pas rappeler `request.text()`.
 */
export async function readBoundedRequestBody(
  request: Request,
  limits: Pick<AgentServerLimits, "max_body_bytes">,
): Promise<{ text: string; byteLength: number }> {
  assertDeclaredBodyLength(request.headers, limits);

  if (!request.body) {
    return { text: "", byteLength: 0 };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limits.max_body_bytes) {
        await reader.cancel();
        throw new AgentServerError("HTTP_BODY_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AgentServerError) {
      throw error;
    }
    throw new AgentServerError("HTTP_BODY_INVALID", 400);
  }

  const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return {
    text: buffer.toString("utf8"),
    byteLength: buffer.byteLength,
  };
}

/**
 * Parse JSON une seule fois + valide ExternalToolRequest (schéma strict G1-K).
 * Refuse champs de confiance (tenant_id, actor_id, token, TrustedExecutionContext, …).
 */
export function parseExternalToolRequestBody(
  rawBodyText: string,
): ParsedExternalToolRequest {
  const trimmed = rawBodyText.trim();
  if (trimmed.length === 0) {
    throw new AgentServerError("HTTP_BODY_INVALID", 400);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new AgentServerError("HTTP_BODY_INVALID", 400);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AgentServerError("HTTP_REQUEST_INVALID", 400);
  }

  const result = externalToolRequestSchema.safeParse(parsed);
  if (!result.success) {
    throw new AgentServerError("HTTP_REQUEST_INVALID", 400);
  }

  return result.data;
}

/**
 * Enchaîne : Content-Type → taille → lecture → JSON → ExternalToolRequest.
 * La méthode HTTP est vérifiée séparément (avant Content-Type).
 */
export async function adaptAgentServerRequest(
  request: Request,
  limits: Pick<AgentServerLimits, "max_body_bytes">,
): Promise<ParsedAgentServerBody> {
  assertJsonContentType(request.headers.get("content-type"));
  const { text, byteLength } = await readBoundedRequestBody(request, limits);
  const externalRequest = parseExternalToolRequestBody(text);
  return {
    externalRequest,
    rawBodyText: text,
    bodyByteLength: byteLength,
  };
}

/** Copie défensive de l’intention — ne mute pas l’entrée. */
export function copyExternalToolRequest(
  request: ExternalToolRequest,
): ExternalToolRequest {
  return {
    tool_id: request.tool_id,
    tool_version: request.tool_version,
    mode: request.mode,
    requested_autonomy_level: request.requested_autonomy_level,
    arguments: request.arguments,
    ...(request.resource !== undefined
      ? {
          resource: {
            kind: request.resource.kind,
            resource_id: request.resource.resource_id,
          },
        }
      : {}),
    ...(request.idempotency_key !== undefined
      ? { idempotency_key: request.idempotency_key }
      : {}),
    ...(request.approval_id !== undefined
      ? { approval_id: request.approval_id }
      : {}),
    ...(request.correlation_id !== undefined
      ? { correlation_id: request.correlation_id }
      : {}),
  };
}
