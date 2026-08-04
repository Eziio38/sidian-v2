/**
 * Transport live Anthropic Messages API (POST /v1/messages) via fetch.
 * Aucun SDK — pas d'outils exposés au modèle, même surface que le transport
 * OpenAI-compatible (`LlmTransport`).
 *
 * Différences de forme assumées par cet adaptateur :
 * - le prompt système est un champ racine `system`, PAS un message de rôle
 *   "system" (l'API rejette ce rôle dans `messages`) ;
 * - `max_tokens` est obligatoire ;
 * - l'authentification passe par `x-api-key` + `anthropic-version` ;
 * - l'usage est reporté en `input_tokens` / `output_tokens`.
 */

import { LlmError } from "../errors";
import type { LlmMessage, LlmTokenUsage, LlmTransport } from "../types";

import {
  classifyLlmHttpStatus,
  isAbortError,
  normalizeLlmTransportError,
} from "./http-errors";

export const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
export const ANTHROPIC_DEFAULT_VERSION = "2023-06-01";

/**
 * Défaut documenté : Claude Haiku 4.5.
 *
 * Le runtime P0 appelle le modèle avec `temperature: 0`, un plafond de sortie
 * de l'ordre du millier de tokens et un timeout HTTP de quelques secondes
 * (extraction structurée déterministe). Les modèles de la famille Claude 5
 * (`claude-opus-5`, `claude-sonnet-5`, `claude-fable-5`) rejettent le
 * paramètre `temperature` et raisonnent par défaut : ils ne tiennent pas ce
 * contrat sans revoir budget et latence. Le modèle reste surchargeable par
 * SIDIAN_LLM_ANTHROPIC_MODEL, et `temperature` est alors omise (cf.
 * MODELS_WITHOUT_SAMPLING) pour éviter un 400.
 */
export const ANTHROPIC_DEFAULT_MODEL = "claude-haiku-4-5";

/**
 * Familles de modèles qui refusent les paramètres d'échantillonnage
 * (`temperature` / `top_p` / `top_k`) avec un 400.
 */
const MODELS_WITHOUT_SAMPLING: readonly RegExp[] = [
  /^claude-opus-5/,
  /^claude-opus-4-7/,
  /^claude-opus-4-8/,
  /^claude-sonnet-5/,
  /^claude-fable-5/,
  /^claude-mythos-5/,
];

export function anthropicModelAcceptsTemperature(model: string): boolean {
  return !MODELS_WITHOUT_SAMPLING.some((re) => re.test(model));
}

/**
 * L'API Messages n'a pas d'équivalent de `response_format: json_object` :
 * la contrainte JSON passe par le prompt système, côté instructions système
 * uniquement — jamais mélangée au contenu utilisateur.
 */
const JSON_MODE_SYSTEM_DIRECTIVE =
  "Réponds exclusivement par un objet JSON valide, sans texte ni balise autour.";

export type AnthropicMessagesTransportConfig = {
  apiKey: string;
  model: string;
  baseUrl?: string;
  anthropicVersion?: string;
  /**
   * Consomme la réponse en SSE (`content_block_delta`) au lieu d'attendre le
   * corps complet. Le résultat rendu à l'appelant reste identique : le
   * transport agrège le flux avant de retourner.
   */
  stream?: boolean;
  fetchImpl?: typeof fetch;
};

export type AnthropicRequestBody = {
  model: string;
  max_tokens: number;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  system?: string;
  temperature?: number;
  stream?: true;
};

type AnthropicTransportInput = Parameters<LlmTransport["complete"]>[0];

/**
 * Corps de requête Anthropic — exporté pour test de forme.
 * Interdit : `tools`, `tool_choice` — surface financière nulle.
 */
export function buildAnthropicRequestBody(
  input: AnthropicTransportInput,
  config: { model: string; stream?: boolean },
): AnthropicRequestBody {
  const systemParts: string[] = [];
  const conversation: Array<{ role: "user" | "assistant"; content: string }> =
    [];

  for (const message of input.messages as LlmMessage[]) {
    if (message.role === "system") {
      // Le rôle "system" n'existe pas dans `messages` côté Anthropic.
      systemParts.push(message.content);
      continue;
    }
    const previous = conversation[conversation.length - 1];
    if (previous && previous.role === message.role) {
      // L'API attend une alternance : on fusionne les tours consécutifs.
      previous.content = `${previous.content}\n\n${message.content}`;
      continue;
    }
    conversation.push({ role: message.role, content: message.content });
  }

  if (input.json_mode) {
    systemParts.push(JSON_MODE_SYSTEM_DIRECTIVE);
  }

  if (conversation.length === 0) {
    throw new LlmError("LLM_LIVE_MISCONFIGURED", {
      message: "llm_anthropic_no_conversation_message",
    });
  }
  if (conversation[0]?.role !== "user") {
    throw new LlmError("LLM_LIVE_MISCONFIGURED", {
      message: "llm_anthropic_first_message_not_user",
    });
  }

  const body: AnthropicRequestBody = {
    model: config.model,
    // Obligatoire côté Anthropic, contrairement à OpenAI.
    max_tokens: input.max_output_tokens,
    messages: conversation,
  };
  if (systemParts.length > 0) {
    body.system = systemParts.join("\n\n");
  }
  if (anthropicModelAcceptsTemperature(config.model)) {
    body.temperature = input.temperature;
  }
  if (config.stream) {
    body.stream = true;
  }
  return body;
}

/**
 * `error.type` Anthropic → taxonomie commune.
 * Le message provider n'est jamais repris (il peut contenir du contenu).
 */
export function classifyAnthropicErrorType(type: string): LlmError {
  switch (type) {
    case "authentication_error":
    case "permission_error":
      return new LlmError("LLM_PROVIDER_AUTH", {
        message: `llm_anthropic_${type}`,
      });
    case "rate_limit_error":
      return new LlmError("LLM_PROVIDER_RATE_LIMITED", {
        message: "llm_rate_limited",
      });
    case "invalid_request_error":
    case "not_found_error":
    case "request_too_large":
      return new LlmError("LLM_LIVE_MISCONFIGURED", {
        message: `llm_anthropic_${type}`,
      });
    case "overloaded_error":
    case "api_error":
      return new LlmError("LLM_PROVIDER_ERROR", {
        message: `llm_anthropic_${type}`,
      });
    default:
      return new LlmError("LLM_PROVIDER_ERROR", {
        message: "llm_anthropic_error",
      });
  }
}

function usageFromAnthropic(
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): LlmTokenUsage | undefined {
  if (typeof inputTokens !== "number" || typeof outputTokens !== "number") {
    return undefined;
  }
  // Anthropic ne renvoie pas de total : on l'agrège sur la forme commune.
  return {
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
  };
}

export type AnthropicAccumulatedMessage = {
  content: string;
  usage?: LlmTokenUsage;
  stop_reason?: string;
};

type AnthropicJsonResponse = {
  content?: Array<{ type?: string; text?: string }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
};

export function accumulateAnthropicJsonResponse(
  json: unknown,
): AnthropicAccumulatedMessage {
  const payload = json as AnthropicJsonResponse;
  const content = (payload.content ?? [])
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("");
  return {
    content,
    stop_reason: payload.stop_reason,
    usage: usageFromAnthropic(
      payload.usage?.input_tokens,
      payload.usage?.output_tokens,
    ),
  };
}

/**
 * Agrège un flux SSE Anthropic déjà découpé en trames `data:`.
 * Seuls les `text_delta` sont concaténés : un éventuel bloc de raisonnement
 * (`thinking_delta`) n'est jamais restitué à l'appelant.
 */
export function accumulateAnthropicSseFrame(
  raw: string,
  state: AnthropicAccumulatedMessage & { _texts: string[] },
): void {
  if (raw.length === 0 || raw === "[DONE]") return;

  let event: {
    type?: string;
    delta?: { type?: string; text?: string; stop_reason?: string };
    message?: { usage?: { input_tokens?: number; output_tokens?: number } };
    usage?: { input_tokens?: number; output_tokens?: number };
    error?: { type?: string };
  };
  try {
    event = JSON.parse(raw) as typeof event;
  } catch {
    throw new LlmError("LLM_OUTPUT_INVALID", {
      message: "llm_anthropic_sse_not_json",
    });
  }

  switch (event.type) {
    case "message_start": {
      const usage = event.message?.usage;
      state.usage = usageFromAnthropic(
        usage?.input_tokens,
        usage?.output_tokens ?? 0,
      );
      break;
    }
    case "content_block_delta": {
      if (event.delta?.type === "text_delta" && typeof event.delta.text === "string") {
        state._texts.push(event.delta.text);
      }
      break;
    }
    case "message_delta": {
      if (event.delta?.stop_reason) {
        state.stop_reason = event.delta.stop_reason;
      }
      if (typeof event.usage?.output_tokens === "number") {
        const promptTokens =
          event.usage.input_tokens ?? state.usage?.prompt_tokens ?? 0;
        state.usage = usageFromAnthropic(
          promptTokens,
          event.usage.output_tokens,
        );
      }
      break;
    }
    case "error": {
      throw classifyAnthropicErrorType(event.error?.type ?? "");
    }
    default:
      break;
  }
}

async function* iterateResponseChunks(
  response: Response,
): AsyncGenerator<string> {
  const body = response.body as ReadableStream<Uint8Array> | null | undefined;
  if (!body || typeof body.getReader !== "function") {
    // Certains polyfills fetch n'exposent pas de flux : on retombe sur le
    // corps complet, la trame SSE reste parsable d'un bloc.
    yield await response.text();
    return;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield decoder.decode(value, { stream: true });
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    reader.releaseLock?.();
  }
}

/**
 * Lit un flux SSE Anthropic complet et rend le message agrégé.
 */
export async function readAnthropicMessagesStream(
  response: Response,
): Promise<AnthropicAccumulatedMessage> {
  const state: AnthropicAccumulatedMessage & { _texts: string[] } = {
    content: "",
    _texts: [],
  };
  let buffer = "";

  const consumeFrame = (frame: string): void => {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    accumulateAnthropicSseFrame(data, state);
  };

  for await (const chunk of iterateResponseChunks(response)) {
    buffer += chunk;
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      consumeFrame(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim().length > 0) {
    consumeFrame(buffer);
  }

  return {
    content: state._texts.join(""),
    usage: state.usage,
    stop_reason: state.stop_reason,
  };
}

/**
 * Client HTTP Anthropic isolé — jamais de `tools` dans le payload.
 */
export function createAnthropicMessagesTransport(
  config: AnthropicMessagesTransportConfig,
): LlmTransport {
  const fetchImpl = config.fetchImpl ?? fetch;
  const baseUrl = (config.baseUrl ?? ANTHROPIC_DEFAULT_BASE_URL).replace(
    /\/$/,
    "",
  );
  const anthropicVersion = config.anthropicVersion ?? ANTHROPIC_DEFAULT_VERSION;

  return {
    provider_id: `anthropic:${config.model}`,
    mode: "live",
    async complete(input) {
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      input.signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), input.timeout_ms);

      try {
        const body = buildAnthropicRequestBody(input, {
          model: config.model,
          stream: config.stream,
        });

        const response = await fetchImpl(`${baseUrl}/messages`, {
          method: "POST",
          headers: {
            // Anthropic n'utilise pas Authorization: Bearer.
            "x-api-key": config.apiKey,
            "anthropic-version": anthropicVersion,
            "Content-Type": "application/json",
            Accept: config.stream ? "text/event-stream" : "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          // Le corps d'erreur n'est pas relu : le statut suffit et ne peut
          // pas transporter de secret.
          throw classifyLlmHttpStatus(response.status);
        }

        const message = config.stream
          ? await readAnthropicMessagesStream(response)
          : accumulateAnthropicJsonResponse(await parseJsonBody(response));

        if (message.stop_reason === "refusal") {
          // Refus de politique : HTTP 200, non retryable, aucune bascule.
          throw new LlmError("LLM_OUTPUT_INVALID", {
            message: "llm_model_refusal",
          });
        }

        if (message.content.length === 0) {
          throw new LlmError("LLM_OUTPUT_INVALID", {
            message: "llm_empty_content",
          });
        }

        return { content: message.content, usage: message.usage };
      } catch (err) {
        if (err instanceof LlmError) throw err;
        if (isAbortError(err)) {
          throw new LlmError("LLM_TIMEOUT", { message: "llm_timeout" });
        }
        throw normalizeLlmTransportError(err);
      } finally {
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

async function parseJsonBody(response: Response): Promise<unknown> {
  const rawText = await response.text();
  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    throw new LlmError("LLM_OUTPUT_INVALID", {
      message: "llm_non_json_http_body",
    });
  }
}
