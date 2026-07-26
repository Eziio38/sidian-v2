/**
 * Constructeurs Request HTTP pour tests G1-L.
 */

import { baseExternalRequest } from "@/lib/agent/gateway/test-fixtures";
import type { ExternalToolRequest } from "@/lib/agent/gateway";

import {
  AGENT_SERVER_TEST_URL,
  BEARER_TOKEN_VALID,
  CORRELATION_ID,
} from "./constants";

export type AgentHttpRequestOptions = {
  method?: string;
  /** Objet ExternalToolRequest (ou poison) — sérialisé JSON. */
  body?: unknown;
  /** Corps brut (prioritaire sur `body` si fourni). */
  rawBody?: string | Uint8Array;
  headers?: Record<string, string | undefined | null>;
  /** Bearer → Authorization. `null` = pas d’Authorization. */
  bearer?: string | null;
  /** Hint tenant non fiable (header x-sidian-tenant-id). */
  tenantHint?: string;
  /** Content-Type. `null` = omettre le header. Défaut application/json. */
  contentType?: string | null;
  correlationId?: string;
  signal?: AbortSignal;
  url?: string;
};

/**
 * Construit une Request Web pour `createAgentServerHandler`.
 */
export function createAgentHttpRequest(
  options: AgentHttpRequestOptions = {},
): Request {
  const method = options.method ?? "POST";
  const headers = new Headers();

  const contentType =
    options.contentType === undefined
      ? "application/json"
      : options.contentType;
  if (contentType !== null) {
    headers.set("content-type", contentType);
  }

  if (options.bearer === undefined) {
    headers.set("Authorization", `Bearer ${BEARER_TOKEN_VALID}`);
  } else if (options.bearer !== null) {
    headers.set("Authorization", `Bearer ${options.bearer}`);
  }

  if (options.tenantHint) {
    headers.set("x-sidian-tenant-id", options.tenantHint);
  }

  if (options.correlationId) {
    headers.set("x-correlation-id", options.correlationId);
  }

  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      if (value === null) {
        headers.delete(key);
      } else if (value !== undefined) {
        headers.set(key, value);
      }
    }
  }

  let bodyInit: BodyInit | undefined;
  if (options.rawBody !== undefined) {
    bodyInit =
      typeof options.rawBody === "string"
        ? options.rawBody
        : // Cast : TS 5.x Uint8Array<ArrayBufferLike> vs BodyInit BufferSource.
          (Uint8Array.from(options.rawBody) as unknown as BodyInit);
  } else if (options.body !== undefined) {
    bodyInit = JSON.stringify(options.body);
  } else if (method !== "GET" && method !== "HEAD") {
    bodyInit = JSON.stringify(nominalExternalBody());
  }

  // Évite le Content-Type implicite `text/plain` d’undici sur string body
  // lorsque le test exige l’absence explicite du header.
  if (
    contentType === null &&
    typeof bodyInit === "string" &&
    method !== "GET" &&
    method !== "HEAD"
  ) {
    bodyInit = new TextEncoder().encode(bodyInit) as unknown as BodyInit;
  }

  if (bodyInit !== undefined && !headers.has("content-length")) {
    const byteLength =
      typeof bodyInit === "string"
        ? Buffer.byteLength(bodyInit, "utf8")
        : bodyInit instanceof Uint8Array
          ? bodyInit.byteLength
          : undefined;
    if (byteLength !== undefined) {
      headers.set("content-length", String(byteLength));
    }
  }

  return new Request(options.url ?? AGENT_SERVER_TEST_URL, {
    method,
    headers,
    body: bodyInit,
    signal: options.signal,
  });
}

/** Body ExternalToolRequest nominal (lecture invoice.get). */
export function nominalExternalBody(
  overrides: Partial<ExternalToolRequest> = {},
): ExternalToolRequest {
  const base = baseExternalRequest({
    correlation_id: CORRELATION_ID,
    arguments: { invoice_id: "inv_g1l_001" },
    ...overrides,
  });
  // Pas d’approval_id / idempotency_key par défaut :
  // sinon APPROVAL_UNAVAILABLE / IDEMPOTENCY_UNAVAILABLE sans services H/G.
  let result: ExternalToolRequest = base;
  if (!("approval_id" in overrides)) {
    const rest = { ...result };
    delete rest.approval_id;
    result = rest;
  }
  if (!("idempotency_key" in overrides)) {
    const rest = { ...result };
    delete rest.idempotency_key;
    result = rest;
  }
  return result;
}

/** Poison — champ interdit / inconnu dans le body JSON. */
export function poisonedExternalBody(
  field: string,
  value: unknown,
): Record<string, unknown> {
  return {
    ...nominalExternalBody(),
    [field]: value,
  };
}
