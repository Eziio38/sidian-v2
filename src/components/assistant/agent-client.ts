/**
 * Adaptateur UI → POST /api/agent/tools.
 * Aucune logique métier : transport HTTP + parsing de la réponse sanitizée.
 */

export type AgentToolCallInput = {
  tool_id: string;
  tool_version: string;
  mode: "agir" | "conseiller";
  requested_autonomy_level: number;
  arguments: Record<string, unknown>;
  idempotency_key?: string;
  correlation_id?: string;
};

export type AgentToolSuccess<TOutput = Record<string, unknown>> = {
  ok: true;
  request_id: string;
  correlation_id: string;
  tool_id: string;
  tool_version: string;
  output: TOutput;
};

export type AgentToolFailure = {
  ok: false;
  request_id?: string;
  correlation_id?: string;
  code: string;
  message: string;
  httpStatus: number;
  retryable: boolean;
};

export type AgentToolResult<TOutput = Record<string, unknown>> =
  | AgentToolSuccess<TOutput>
  | AgentToolFailure;

export type AgentTransport = <TOutput = Record<string, unknown>>(
  input: AgentToolCallInput,
  init?: { signal?: AbortSignal },
) => Promise<AgentToolResult<TOutput>>;

const RETRYABLE_HTTP = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set([
  "AGENT_DEPENDENCY_UNAVAILABLE",
  "PROVIDER_TIMEOUT",
  "provider_timeout",
  "INTERNAL_SERVER_ERROR",
  "HTTP_UPSTREAM_TIMEOUT",
]);

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

export const callAgentTool: AgentTransport = async <TOutput = Record<string, unknown>>(
  input: AgentToolCallInput,
  init?: { signal?: AbortSignal },
): Promise<AgentToolResult<TOutput>> => {
  const body: Record<string, unknown> = {
    tool_id: input.tool_id,
    tool_version: input.tool_version,
    mode: input.mode,
    requested_autonomy_level: input.requested_autonomy_level,
    arguments: input.arguments,
  };
  if (input.idempotency_key) {
    body.idempotency_key = input.idempotency_key;
  }
  if (input.correlation_id) {
    body.correlation_id = input.correlation_id;
  }

  let response: Response;
  try {
    response = await fetch("/api/agent/tools", {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: init?.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        ok: false,
        code: "ABORTED",
        message: "Requête annulée.",
        httpStatus: 0,
        retryable: false,
      };
    }
    return {
      ok: false,
      code: "NETWORK_ERROR",
      message: "Impossible de joindre Sidian. Vérifie ta connexion.",
      httpStatus: 0,
      retryable: true,
    };
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      code: "HTTP_BODY_INVALID",
      message: "Réponse invalide du serveur.",
      httpStatus: response.status,
      retryable: RETRYABLE_HTTP.has(response.status),
    };
  }

  const request_id = readString(payload.request_id);
  const correlation_id = readString(payload.correlation_id);
  const data =
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : {};

  if (!response.ok || payload.status === "error") {
    const code = readString(payload.code, `HTTP_${response.status}`);
    const message = readString(
      data.message,
      "Une erreur est survenue. Réessaie dans un instant.",
    );
    return {
      ok: false,
      request_id: request_id || undefined,
      correlation_id: correlation_id || undefined,
      code,
      message,
      httpStatus: response.status,
      retryable:
        RETRYABLE_HTTP.has(response.status) || RETRYABLE_CODES.has(code),
    };
  }

  return {
    ok: true,
    request_id,
    correlation_id,
    tool_id: readString(data.tool_id, input.tool_id),
    tool_version: readString(data.tool_version, input.tool_version),
    output: (data.output ?? {}) as TOutput,
  };
};
