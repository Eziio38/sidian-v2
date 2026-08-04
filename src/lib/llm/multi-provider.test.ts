/**
 * Tests multi-provider — adaptateur Anthropic, parité de taxonomie
 * d'erreurs avec OpenAI, bascule de secours bornée.
 */

import { describe, expect, it, vi } from "vitest";

import { loadLlmEnv } from "./env";
import { LlmError } from "./errors";
import { createLlmRuntimeFromEnv } from "./factory";
import { InMemoryLlmObservabilitySink } from "./observability";
import {
  ANTHROPIC_DEFAULT_MODEL,
  anthropicModelAcceptsTemperature,
  buildAnthropicRequestBody,
  createAnthropicMessagesTransport,
  readAnthropicMessagesStream,
} from "./providers/anthropic-messages";
import {
  createFailoverLlmTransport,
  type LlmFailoverEvent,
} from "./providers/failover";
import { classifyLlmHttpStatus } from "./providers/http-errors";
import { createOpenAiCompatibleTransport } from "./providers/openai-compatible";
import { createStubLlmTransport } from "./providers/stub";
import type { LlmTransport } from "./types";

const BASE_INPUT = {
  messages: [
    { role: "system" as const, content: "Instructions système." },
    { role: "user" as const, content: "Bonjour" },
  ],
  max_output_tokens: 256,
  temperature: 0,
  json_mode: false,
  timeout_ms: 2_000,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function anthropicOkBody(text = '{"ok":true}') {
  return {
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 11, output_tokens: 7 },
  };
}

function sseResponse(frames: string[]): Response {
  return new Response(frames.join(""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("Anthropic — forme de requête", () => {
  it("place le prompt système en champ racine, jamais en rôle message", () => {
    const body = buildAnthropicRequestBody(BASE_INPUT, {
      model: "claude-haiku-4-5",
    });
    expect(body.system).toBe("Instructions système.");
    expect(body.messages).toEqual([{ role: "user", content: "Bonjour" }]);
    expect(body.messages.some((m) => m.role === ("system" as never))).toBe(
      false,
    );
  });

  it("max_tokens est toujours présent (obligatoire côté Anthropic)", () => {
    const body = buildAnthropicRequestBody(BASE_INPUT, {
      model: "claude-haiku-4-5",
    });
    expect(body.max_tokens).toBe(256);
  });

  it("json_mode ajoute une directive système, pas un contenu utilisateur", () => {
    const body = buildAnthropicRequestBody(
      { ...BASE_INPUT, json_mode: true },
      { model: "claude-haiku-4-5" },
    );
    expect(body.system).toContain("JSON");
    expect(body.messages[0]?.content).toBe("Bonjour");
  });

  it("omet temperature pour les modèles qui la rejettent", () => {
    expect(anthropicModelAcceptsTemperature(ANTHROPIC_DEFAULT_MODEL)).toBe(true);
    expect(anthropicModelAcceptsTemperature("claude-opus-5")).toBe(false);

    const haiku = buildAnthropicRequestBody(BASE_INPUT, {
      model: "claude-haiku-4-5",
    });
    expect(haiku.temperature).toBe(0);

    const opus5 = buildAnthropicRequestBody(BASE_INPUT, {
      model: "claude-opus-5",
    });
    expect(opus5.temperature).toBeUndefined();
  });

  it("n'expose jamais d'outils au modèle", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(anthropicOkBody()));
    const transport = createAnthropicMessagesTransport({
      apiKey: "sk-ant-test",
      model: "claude-haiku-4-5",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await transport.complete(BASE_INPUT);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers.Authorization).toBeUndefined();

    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    expect(body.functions).toBeUndefined();
  });

  it("mappe input_tokens / output_tokens sur la forme d'usage commune", async () => {
    const transport = createAnthropicMessagesTransport({
      apiKey: "sk-ant-test",
      model: "claude-haiku-4-5",
      fetchImpl: (async () =>
        jsonResponse(anthropicOkBody())) as unknown as typeof fetch,
    });
    const result = await transport.complete(BASE_INPUT);
    expect(result.usage).toEqual({
      prompt_tokens: 11,
      completion_tokens: 7,
      total_tokens: 18,
    });
  });

  it("propage l'abort de l'appelant", async () => {
    const controller = new AbortController();
    const transport = createAnthropicMessagesTransport({
      apiKey: "sk-ant-test",
      model: "claude-haiku-4-5",
      fetchImpl: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
          });
        })) as unknown as typeof fetch,
    });
    const pending = transport.complete({ ...BASE_INPUT, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "LLM_TIMEOUT" });
  });
});

describe("Anthropic — streaming SSE", () => {
  it("agrège les content_block_delta et l'usage", async () => {
    const response = sseResponse([
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":0}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"{\\"ok\\":"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"true}"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":9}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]);

    const message = await readAnthropicMessagesStream(response);
    expect(message.content).toBe('{"ok":true}');
    expect(message.stop_reason).toBe("end_turn");
    expect(message.usage).toEqual({
      prompt_tokens: 12,
      completion_tokens: 9,
      total_tokens: 21,
    });
  });

  it("ignore les deltas de raisonnement", async () => {
    const message = await readAnthropicMessagesStream(
      sseResponse([
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"interne"}}\n\n',
        'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"visible"}}\n\n',
      ]),
    );
    expect(message.content).toBe("visible");
  });

  it("un event error du flux devient une LlmError typée", async () => {
    await expect(
      readAnthropicMessagesStream(
        sseResponse([
          'event: error\ndata: {"type":"error","error":{"type":"overloaded_error"}}\n\n',
        ]),
      ),
    ).rejects.toMatchObject({
      code: "LLM_PROVIDER_ERROR",
      retryable: true,
    });
  });

  it("le transport en mode stream rend le même contrat que le mode JSON", async () => {
    const transport = createAnthropicMessagesTransport({
      apiKey: "sk-ant-test",
      model: "claude-haiku-4-5",
      stream: true,
      fetchImpl: (async (_url: string, init: RequestInit) => {
        expect(
          (JSON.parse(String(init.body)) as { stream?: boolean }).stream,
        ).toBe(true);
        return sseResponse([
          'data: {"type":"message_start","message":{"usage":{"input_tokens":3,"output_tokens":0}}}\n\n',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n',
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n',
        ]);
      }) as unknown as typeof fetch,
    });
    const result = await transport.complete(BASE_INPUT);
    expect(result.content).toBe("ok");
    expect(result.usage?.total_tokens).toBe(5);
  });
});

describe("Parité de taxonomie d'erreurs entre providers", () => {
  function anthropicWithStatus(status: number): LlmTransport {
    return createAnthropicMessagesTransport({
      apiKey: "sk-ant-test",
      model: "claude-haiku-4-5",
      fetchImpl: (async () =>
        new Response("{}", { status })) as unknown as typeof fetch,
    });
  }

  function openAiWithStatus(status: number): LlmTransport {
    return createOpenAiCompatibleTransport({
      apiKey: "sk-openai-test",
      baseUrl: "https://example.test/v1",
      model: "gpt-test",
      fetchImpl: (async () =>
        new Response("{}", { status })) as unknown as typeof fetch,
    });
  }

  it.each([401, 403, 429, 400, 404, 500, 503])(
    "statut %i : même code et même retryable des deux côtés",
    async (status) => {
      const expected = classifyLlmHttpStatus(status);
      for (const transport of [
        anthropicWithStatus(status),
        openAiWithStatus(status),
      ]) {
        await expect(transport.complete(BASE_INPUT)).rejects.toMatchObject({
          code: expected.code,
          retryable: expected.retryable,
        });
      }
    },
  );

  it("un 4xx de requête n'est pas retryable (pas de bascule inutile)", () => {
    expect(classifyLlmHttpStatus(400).retryable).toBe(false);
    expect(classifyLlmHttpStatus(401).retryable).toBe(false);
    expect(classifyLlmHttpStatus(429).retryable).toBe(true);
    expect(classifyLlmHttpStatus(503).retryable).toBe(true);
  });

  it("un refus du modèle (HTTP 200) est une erreur de validation non retryable", async () => {
    const transport = createAnthropicMessagesTransport({
      apiKey: "sk-ant-test",
      model: "claude-haiku-4-5",
      fetchImpl: (async () =>
        jsonResponse({
          content: [{ type: "text", text: "Je ne peux pas." }],
          stop_reason: "refusal",
          usage: { input_tokens: 5, output_tokens: 4 },
        })) as unknown as typeof fetch,
    });
    await expect(transport.complete(BASE_INPUT)).rejects.toMatchObject({
      code: "LLM_OUTPUT_INVALID",
      retryable: false,
    });
  });

  it("aucun statut ne fait fuiter de matière de clé dans l'erreur", async () => {
    const secret = "sk-ant-super-secret-value";
    const transport = createAnthropicMessagesTransport({
      apiKey: secret,
      model: "claude-haiku-4-5",
      fetchImpl: (async () =>
        new Response(JSON.stringify({ error: { message: secret } }), {
          status: 401,
        })) as unknown as typeof fetch,
    });
    await expect(transport.complete(BASE_INPUT)).rejects.toSatisfy(
      (err: unknown) => {
        const serialized = `${String(err)}|${(err as Error).message}|${JSON.stringify(err)}`;
        return !serialized.includes(secret);
      },
    );
  });
});

describe("Bascule de secours", () => {
  function transportThatFails(error: LlmError): LlmTransport {
    return {
      provider_id: "primaire:test",
      mode: "live",
      async complete() {
        throw error;
      },
    };
  }

  const healthyFallback: LlmTransport = {
    provider_id: "secours:test",
    mode: "live",
    async complete() {
      return {
        content: "servi par le secours",
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      };
    },
  };

  it("bascule sur une panne de transport retryable et journalise le provider", async () => {
    const events: LlmFailoverEvent[] = [];
    const transport = createFailoverLlmTransport({
      primary: transportThatFails(
        new LlmError("LLM_PROVIDER_ERROR", { message: "llm_http_503" }),
      ),
      fallback: healthyFallback,
      onProviderServed: (event) => events.push(event),
    });

    const result = await transport.complete(BASE_INPUT);
    expect(result.content).toBe("servi par le secours");
    expect(events).toEqual([
      {
        provider_id: "primaire:test",
        role: "primary",
        ok: false,
        error_code: "LLM_PROVIDER_ERROR",
      },
      { provider_id: "secours:test", role: "fallback", ok: true },
    ]);
  });

  it("ne bascule PAS sur un refus du modèle", async () => {
    const events: LlmFailoverEvent[] = [];
    const transport = createFailoverLlmTransport({
      primary: transportThatFails(
        new LlmError("LLM_OUTPUT_INVALID", { message: "llm_model_refusal" }),
      ),
      fallback: healthyFallback,
      onProviderServed: (event) => events.push(event),
    });

    await expect(transport.complete(BASE_INPUT)).rejects.toMatchObject({
      code: "LLM_OUTPUT_INVALID",
    });
    expect(events.some((e) => e.role === "fallback")).toBe(false);
  });

  it("ne bascule PAS sur une erreur de validation / configuration ni sur l'auth", async () => {
    for (const code of ["LLM_LIVE_MISCONFIGURED", "LLM_PROVIDER_AUTH"] as const) {
      const events: LlmFailoverEvent[] = [];
      const transport = createFailoverLlmTransport({
        primary: transportThatFails(new LlmError(code)),
        fallback: healthyFallback,
        onProviderServed: (event) => events.push(event),
      });
      await expect(transport.complete(BASE_INPUT)).rejects.toMatchObject({
        code,
      });
      expect(events.some((e) => e.role === "fallback")).toBe(false);
    }
  });

  it("une seule tentative de secours, jamais de cascade", async () => {
    let fallbackCalls = 0;
    const transport = createFailoverLlmTransport({
      primary: transportThatFails(new LlmError("LLM_PROVIDER_RATE_LIMITED")),
      fallback: {
        provider_id: "secours:test",
        mode: "live",
        async complete() {
          fallbackCalls += 1;
          throw new LlmError("LLM_PROVIDER_ERROR", { message: "llm_http_500" });
        },
      },
      onProviderServed: () => {},
    });
    await expect(transport.complete(BASE_INPUT)).rejects.toMatchObject({
      code: "LLM_PROVIDER_ERROR",
    });
    expect(fallbackCalls).toBe(1);
  });

  it("aucun secours configuré → transport primaire inchangé", () => {
    const primary = createStubLlmTransport();
    expect(createFailoverLlmTransport({ primary })).toBe(primary);
  });

  it("signal déjà avorté → pas de secours (budget temps épuisé)", async () => {
    const controller = new AbortController();
    controller.abort();
    let fallbackCalls = 0;
    const transport = createFailoverLlmTransport({
      primary: transportThatFails(new LlmError("LLM_TIMEOUT")),
      fallback: {
        provider_id: "secours:test",
        mode: "live",
        async complete() {
          fallbackCalls += 1;
          return { content: "non attendu" };
        },
      },
      onProviderServed: () => {},
    });
    await expect(
      transport.complete({ ...BASE_INPUT, signal: controller.signal }),
    ).rejects.toMatchObject({ code: "LLM_TIMEOUT" });
    expect(fallbackCalls).toBe(0);
  });
});

describe("Factory multi-provider", () => {
  const LIVE_ANTHROPIC = {
    SIDIAN_LLM_PROVIDER_ENABLED: "true",
    SIDIAN_LLM_TRANSPORT_MODE: "live",
    SIDIAN_LLM_PROVIDER: "anthropic",
    SIDIAN_LLM_ANTHROPIC_API_KEY: "sk-ant-test",
  } as const;

  it("construit le transport Anthropic depuis l'env", async () => {
    const sink = new InMemoryLlmObservabilitySink();
    const fetchImpl = vi.fn(async () => jsonResponse(anthropicOkBody()));
    const runtime = createLlmRuntimeFromEnv({
      env: loadLlmEnv(LIVE_ANTHROPIC),
      observability: sink,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(runtime.provider_id).toBe(`anthropic:${ANTHROPIC_DEFAULT_MODEL}`);

    const result = await runtime.complete({
      purpose: "structured_extraction",
      messages: [
        { role: "system", content: "Extrais." },
        { role: "user", content: "Client Dupont" },
      ],
      json_mode: true,
    });
    expect(result.content).toBe('{"ok":true}');
    expect(sink.events[0]?.ok).toBe(true);
    expect(sink.events[0]?.prompt_tokens).toBe(11);
  });

  it("un secours configuré rend un transport de bascule", () => {
    const runtime = createLlmRuntimeFromEnv({
      env: loadLlmEnv({
        ...LIVE_ANTHROPIC,
        SIDIAN_LLM_FALLBACK_PROVIDER: "openai",
        SIDIAN_LLM_OPENAI_API_KEY: "sk-openai-test",
      }),
      fetchImpl: (async () =>
        jsonResponse(anthropicOkBody())) as unknown as typeof fetch,
    });
    expect(runtime.provider_id).toMatch(/^failover:anthropic:.*\|openai-compatible:/);
  });

  it("bascule bout en bout : Anthropic en panne réseau → OpenAI sert", async () => {
    const served: LlmFailoverEvent[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("api.anthropic.com")) {
        throw new TypeError("network down");
      }
      return jsonResponse({
        choices: [{ message: { content: "réponse de secours" } }],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      });
    });

    const runtime = createLlmRuntimeFromEnv({
      env: loadLlmEnv({
        ...LIVE_ANTHROPIC,
        SIDIAN_LLM_FALLBACK_PROVIDER: "openai",
        SIDIAN_LLM_OPENAI_API_KEY: "sk-openai-test",
      }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onProviderServed: (event) => served.push(event),
    });

    const result = await runtime.complete({
      purpose: "assistance_text",
      messages: [{ role: "user", content: "bonjour" }],
    });
    expect(result.content).toBe("réponse de secours");
    expect(served.at(-1)).toMatchObject({ role: "fallback", ok: true });
  });
});
