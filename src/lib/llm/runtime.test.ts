/**
 * Tests P0 — runtime LLM (safety, stub/live, budget, redaction, timeouts).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createLlmBudgetTracker } from "./budget";
import { loadLlmEnv } from "./env";
import { LlmError } from "./errors";
import { createLlmRuntimeFromEnv } from "./factory";
import { describeLlmHealth } from "./health";
import {
  InMemoryLlmObservabilitySink,
} from "./observability";
import { createOpenAiCompatibleTransport } from "./providers/openai-compatible";
import { createStubLlmTransport } from "./providers/stub";
import {
  REDACTED,
  redactSensitive,
  redactText,
  sanitizeUserContentForModel,
} from "./redaction";
import { createLlmRuntime } from "./runtime";
import {
  findForbiddenToolNames,
  isForbiddenToolName,
  LLM_SAFETY_BOUNDARIES,
} from "./safety";
import { resolveConversationalLlmProvider } from "./resolve-conversational-provider";

describe("LLM env", () => {
  it("disabled par défaut sans appel live", () => {
    const env = loadLlmEnv({
      SIDIAN_LLM_PROVIDER_ENABLED: "false",
    });
    expect(env.enabled).toBe(false);
    expect(env.mode).toBe("disabled");
  });

  it("fail-closed live sans API key", () => {
    expect(() =>
      loadLlmEnv({
        SIDIAN_LLM_PROVIDER_ENABLED: "true",
        SIDIAN_LLM_TRANSPORT_MODE: "live",
      }),
    ).toThrow(/live incomplète|API_KEY/i);
  });

  it("variables optionnelles vides traitées comme absentes", () => {
    // `.env.example` déclare `VAR=` : la chaîne vide ne doit pas invalider
    // toute la configuration quand le runtime est désactivé.
    const env = loadLlmEnv({
      SIDIAN_LLM_PROVIDER_ENABLED: "false",
      SIDIAN_LLM_API_KEY: "",
      SIDIAN_LLM_FALLBACK_PROVIDER: "",
      SIDIAN_LLM_OPENAI_API_KEY: "",
      SIDIAN_LLM_ANTHROPIC_API_KEY: "",
    });
    expect(env.mode).toBe("disabled");
    expect(env.fallbackProvider).toBeUndefined();
    expect(env.apiKey).toBeUndefined();
  });

  it("mode explicite requis si enabled", () => {
    expect(() =>
      loadLlmEnv({
        SIDIAN_LLM_PROVIDER_ENABLED: "true",
      }),
    ).toThrow(/TRANSPORT_MODE/);
  });

  it("live ok avec clé", () => {
    const env = loadLlmEnv({
      SIDIAN_LLM_PROVIDER_ENABLED: "true",
      SIDIAN_LLM_TRANSPORT_MODE: "live",
      SIDIAN_LLM_API_KEY: "sk-test-key",
      SIDIAN_LLM_MODEL: "gpt-4o-mini",
    });
    expect(env.mode).toBe("live");
    expect(env.apiKey).toBe("sk-test-key");
    // Compatibilité ascendante : sans SIDIAN_LLM_PROVIDER, on reste OpenAI
    // et les variables génériques alimentent ce provider.
    expect(env.provider).toBe("openai");
    expect(env.fallbackProvider).toBeUndefined();
    expect(env.baseUrl).toBe("https://api.openai.com/v1");
    expect(env.providers.openai.apiKey).toBe("sk-test-key");
    // La clé générique ne fuit jamais vers l'autre provider.
    expect(env.providers.anthropic.apiKey).toBeUndefined();
  });

  it("stub autorisé en local uniquement", () => {
    // Le stub répond de façon déterministe sans jamais appeler de modèle :
    // hors local, ce serait présenter une capacité indisponible comme active.
    const local = loadLlmEnv({
      SIDIAN_LLM_PROVIDER_ENABLED: "true",
      SIDIAN_LLM_TRANSPORT_MODE: "stub",
      SIDIAN_ENVIRONMENT: "local",
    });
    expect(local.mode).toBe("stub");

    for (const environment of ["staging", "production"]) {
      expect(() =>
        loadLlmEnv({
          SIDIAN_LLM_PROVIDER_ENABLED: "true",
          SIDIAN_LLM_TRANSPORT_MODE: "stub",
          SIDIAN_ENVIRONMENT: environment,
        }),
      ).toThrow(/stub interdit/i);
    }

    // Repli sur VERCEL_ENV quand SIDIAN_ENVIRONMENT est absent.
    expect(() =>
      loadLlmEnv({
        SIDIAN_LLM_PROVIDER_ENABLED: "true",
        SIDIAN_LLM_TRANSPORT_MODE: "stub",
        VERCEL_ENV: "preview",
      }),
    ).toThrow(/stub interdit/i);
  });

  it("production : provider activé exige le mode live", () => {
    expect(() =>
      loadLlmEnv({
        SIDIAN_LLM_PROVIDER_ENABLED: "true",
        SIDIAN_LLM_TRANSPORT_MODE: "disabled",
        SIDIAN_ENVIRONMENT: "production",
      }),
    ).toThrow(/mode live requis en production/i);

    // Désactiver franchement le provider reste permis en production.
    const off = loadLlmEnv({
      SIDIAN_LLM_PROVIDER_ENABLED: "false",
      SIDIAN_ENVIRONMENT: "production",
    });
    expect(off.mode).toBe("disabled");
  });
});

describe("LLM env — sélection de provider", () => {
  const LIVE = {
    SIDIAN_LLM_PROVIDER_ENABLED: "true",
    SIDIAN_LLM_TRANSPORT_MODE: "live",
  } as const;

  it("anthropic primaire : clé et modèle dédiés", () => {
    const env = loadLlmEnv({
      ...LIVE,
      SIDIAN_LLM_PROVIDER: "anthropic",
      SIDIAN_LLM_ANTHROPIC_API_KEY: "sk-ant-test",
      SIDIAN_LLM_ANTHROPIC_MODEL: "claude-haiku-4-5",
    });
    expect(env.provider).toBe("anthropic");
    expect(env.model).toBe("claude-haiku-4-5");
    expect(env.baseUrl).toBe("https://api.anthropic.com/v1");
    expect(env.providers.anthropic.anthropicVersion).toBe("2023-06-01");
  });

  it("ANTHROPIC_API_KEY accepté en repli, derrière la variable SIDIAN_LLM_*", () => {
    const alias = loadLlmEnv({
      ...LIVE,
      SIDIAN_LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "sk-ant-alias",
    });
    expect(alias.apiKey).toBe("sk-ant-alias");

    const precedence = loadLlmEnv({
      ...LIVE,
      SIDIAN_LLM_PROVIDER: "anthropic",
      SIDIAN_LLM_ANTHROPIC_API_KEY: "sk-ant-canonique",
      ANTHROPIC_API_KEY: "sk-ant-alias",
    });
    expect(precedence.apiKey).toBe("sk-ant-canonique");
  });

  it("fail-closed : provider primaire sans clé", () => {
    expect(() =>
      loadLlmEnv({
        ...LIVE,
        SIDIAN_LLM_PROVIDER: "anthropic",
        // Une clé OpenAI ne rend jamais Anthropic opérationnel.
        SIDIAN_LLM_OPENAI_API_KEY: "sk-openai",
      }),
    ).toThrow(/live incomplète|API_KEY/i);
  });

  it("fail-closed : provider de secours sans clé", () => {
    expect(() =>
      loadLlmEnv({
        ...LIVE,
        SIDIAN_LLM_PROVIDER: "openai",
        SIDIAN_LLM_API_KEY: "sk-openai",
        SIDIAN_LLM_FALLBACK_PROVIDER: "anthropic",
      }),
    ).toThrow(/secours/i);
  });

  it("refuse un secours identique au primaire", () => {
    expect(() =>
      loadLlmEnv({
        ...LIVE,
        SIDIAN_LLM_PROVIDER: "openai",
        SIDIAN_LLM_API_KEY: "sk-openai",
        SIDIAN_LLM_FALLBACK_PROVIDER: "openai",
      }),
    ).toThrow(/doit différer/i);
  });

  it("secours complet accepté", () => {
    const env = loadLlmEnv({
      ...LIVE,
      SIDIAN_LLM_PROVIDER: "anthropic",
      SIDIAN_LLM_ANTHROPIC_API_KEY: "sk-ant",
      SIDIAN_LLM_FALLBACK_PROVIDER: "openai",
      SIDIAN_LLM_OPENAI_API_KEY: "sk-openai",
      SIDIAN_LLM_OPENAI_MODEL: "gpt-4o-mini",
    });
    expect(env.fallbackProvider).toBe("openai");
    expect(env.providers.openai.model).toBe("gpt-4o-mini");
    expect(env.streaming).toBe(false);
  });

  it("aucune clé n'apparaît dans les messages d'erreur de config", () => {
    let message = "";
    try {
      loadLlmEnv({
        ...LIVE,
        SIDIAN_LLM_PROVIDER: "anthropic",
        SIDIAN_LLM_OPENAI_API_KEY: "sk-openai-tres-secret",
      });
    } catch (err) {
      message = String(err);
    }
    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toContain("sk-openai-tres-secret");
  });
});

describe("LLM health report", () => {
  it("expose la présence de clé, jamais sa valeur", () => {
    const report = describeLlmHealth(
      loadLlmEnv({
        SIDIAN_LLM_PROVIDER_ENABLED: "true",
        SIDIAN_LLM_TRANSPORT_MODE: "live",
        SIDIAN_LLM_PROVIDER: "anthropic",
        SIDIAN_LLM_ANTHROPIC_API_KEY: "sk-ant-secret",
        SIDIAN_LLM_FALLBACK_PROVIDER: "openai",
        SIDIAN_LLM_OPENAI_API_KEY: "sk-openai-secret",
      }),
    );
    expect(report).toMatchObject({
      enabled: true,
      mode: "live",
      provider: "anthropic",
      api_key_present: true,
      fallback_provider: "openai",
      fallback_api_key_present: true,
      streaming: false,
    });
    expect(JSON.stringify(report)).not.toContain("sk-ant-secret");
    expect(JSON.stringify(report)).not.toContain("sk-openai-secret");
  });

  it("config invalide → misconfigured plutôt qu'un throw", () => {
    const report = describeLlmHealth(undefined);
    // process.env de test ne configure pas le LLM : mode disabled attendu,
    // et jamais d'exception propagée à la sonde.
    expect(["disabled", "misconfigured"]).toContain(report.mode);
    expect(report.api_key_present).toBe(false);
  });
});

describe("LLM safety boundaries", () => {
  it("refuse les outils financiers", () => {
    expect(isForbiddenToolName("payment.create_attempt")).toBe(true);
    expect(isForbiddenToolName("debit_now")).toBe(true);
    expect(isForbiddenToolName("protection.draft.confirm")).toBe(true);
    expect(findForbiddenToolNames(["payment.charge", "help.text"])).toEqual([
      "payment.charge",
    ]);
  });

  it("documente les frontières", () => {
    expect(LLM_SAFETY_BOUNDARIES.banned.length).toBeGreaterThan(3);
    expect(LLM_SAFETY_BOUNDARIES.allowed).toContain("assistant_conversation");
  });
});

describe("LLM redaction", () => {
  it("redige email / e164 / jwt dans les logs", () => {
    const raw =
      "contact jean@exemple.fr au +33612345678 token eyJhbGciOiJIUzI1NiJ9.e30.sig";
    const redacted = redactText(raw);
    expect(redacted).not.toContain("jean@exemple.fr");
    expect(redacted).not.toContain("+33612345678");
    expect(redacted).toContain(REDACTED);
  });

  it("redige les clés sensibles d’objets", () => {
    const out = redactSensitive({
      api_key: "sk-secret",
      note: "ok",
      nested: { access_token: "tok" },
    }) as Record<string, unknown>;
    expect(out.api_key).toBe(REDACTED);
    expect(out.note).toBe("ok");
    expect((out.nested as Record<string, unknown>).access_token).toBe(
      REDACTED,
    );
  });

  it("sanitize user conserve email métier mais retire JWT", () => {
    const out = sanitizeUserContentForModel(
      "Client a@b.co Bearer sk-abc eyJhbGciOiJIUzI1NiJ9.e30.sig",
    );
    expect(out).toContain("a@b.co");
    expect(out).not.toContain("eyJ");
    expect(out).toContain(REDACTED);
  });
});

describe("LLM runtime stub / disabled", () => {
  const sink = new InMemoryLlmObservabilitySink();

  afterEach(() => {
    sink.clear();
  });

  it("aucun appel utile en mode disabled", async () => {
    const runtime = createLlmRuntimeFromEnv({
      env: loadLlmEnv({ SIDIAN_LLM_PROVIDER_ENABLED: "false" }),
      observability: sink,
    });
    expect(runtime.mode).toBe("disabled");
    await expect(
      runtime.complete({
        purpose: "assistance_text",
        messages: [{ role: "user", content: "bonjour" }],
      }),
    ).rejects.toMatchObject({ code: "LLM_DISABLED" });
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]?.ok).toBe(false);
    expect(sink.events[0]?.error_code).toBe("LLM_DISABLED");
  });

  it("stub complète sans réseau", async () => {
    const runtime = createLlmRuntimeFromEnv({
      env: loadLlmEnv({
        SIDIAN_LLM_PROVIDER_ENABLED: "true",
        SIDIAN_LLM_TRANSPORT_MODE: "stub",
      }),
      observability: sink,
    });
    const result = await runtime.complete({
      purpose: "text_generation",
      messages: [{ role: "user", content: "hello" }],
    });
    expect(result.mode).toBe("stub");
    expect(result.content.length).toBeGreaterThan(0);
    expect(sink.events[0]?.ok).toBe(true);
    expect(sink.events[0]?.input_fingerprint).toMatch(/^[a-f0-9]{32}$/);
  });

  it("refuse intent financier interdit", async () => {
    const runtime = createLlmRuntime({
      transport: createStubLlmTransport(),
      mode: "stub",
      maxRetries: 0,
      httpTimeoutMs: 1000,
      maxOutputTokens: 256,
      budget: createLlmBudgetTracker({
        maxRequestsPerMinute: 100,
        maxTokensPerMinute: 100_000,
        maxRequestsPerScopePerHour: 1000,
      }),
      observability: sink,
    });
    await expect(
      runtime.complete({
        purpose: "assistance_text",
        intents: ["trigger_debit"],
        messages: [{ role: "user", content: "débiter" }],
      }),
    ).rejects.toMatchObject({ code: "LLM_PURPOSE_FORBIDDEN" });
  });

  it("refuse tout tool_names (aucun outil financier exposé)", async () => {
    const runtime = createLlmRuntime({
      transport: createStubLlmTransport(),
      mode: "stub",
      maxRetries: 0,
      httpTimeoutMs: 1000,
      maxOutputTokens: 256,
      budget: createLlmBudgetTracker({
        maxRequestsPerMinute: 100,
        maxTokensPerMinute: 100_000,
        maxRequestsPerScopePerHour: 1000,
      }),
      observability: sink,
    });
    await expect(
      runtime.complete({
        purpose: "assistant_conversation",
        tool_names: ["payment.create_attempt"],
        messages: [{ role: "user", content: "x" }],
      }),
    ).rejects.toMatchObject({ code: "LLM_PURPOSE_FORBIDDEN" });
  });

  it("timeout provider", async () => {
    const runtime = createLlmRuntime({
      transport: createStubLlmTransport({ delay_ms: 500 }),
      mode: "stub",
      maxRetries: 0,
      httpTimeoutMs: 30,
      maxOutputTokens: 64,
      budget: createLlmBudgetTracker({
        maxRequestsPerMinute: 100,
        maxTokensPerMinute: 100_000,
        maxRequestsPerScopePerHour: 1000,
      }),
      observability: sink,
    });
    await expect(
      runtime.complete({
        purpose: "assistance_text",
        messages: [{ role: "user", content: "x" }],
        timeout_ms: 30,
        max_retries: 0,
      }),
    ).rejects.toMatchObject({ code: "LLM_TIMEOUT" });
  });

  it("erreur provider puis retry épuisé", async () => {
    let calls = 0;
    const transport = createStubLlmTransport({
      content: () => {
        calls += 1;
        throw new LlmError("LLM_PROVIDER_ERROR", { message: "boom" });
      },
    });
    const runtime = createLlmRuntime({
      transport,
      mode: "stub",
      maxRetries: 1,
      httpTimeoutMs: 1000,
      maxOutputTokens: 64,
      budget: createLlmBudgetTracker({
        maxRequestsPerMinute: 100,
        maxTokensPerMinute: 100_000,
        maxRequestsPerScopePerHour: 1000,
      }),
      observability: sink,
    });
    await expect(
      runtime.complete({
        purpose: "text_generation",
        messages: [{ role: "user", content: "x" }],
      }),
    ).rejects.toMatchObject({ code: "LLM_RETRY_EXHAUSTED" });
    expect(calls).toBe(2);
  });

  it("budget RPM fail-closed", async () => {
    const budget = createLlmBudgetTracker({
      maxRequestsPerMinute: 1,
      maxTokensPerMinute: 100_000,
      maxRequestsPerScopePerHour: 1000,
    });
    const runtime = createLlmRuntime({
      transport: createStubLlmTransport({ content: "ok" }),
      mode: "stub",
      maxRetries: 0,
      httpTimeoutMs: 1000,
      maxOutputTokens: 64,
      budget,
      observability: sink,
    });
    await runtime.complete({
      purpose: "text_generation",
      messages: [{ role: "user", content: "1" }],
    });
    await expect(
      runtime.complete({
        purpose: "text_generation",
        messages: [{ role: "user", content: "2" }],
      }),
    ).rejects.toMatchObject({ code: "LLM_BUDGET_EXCEEDED" });
  });
});

describe("LLM live transport", () => {
  it("n’envoie jamais tools dans le body", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200 },
      );
    });
    const transport = createOpenAiCompatibleTransport({
      apiKey: "sk-test",
      baseUrl: "https://example.test/v1",
      model: "gpt-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await transport.complete({
      messages: [{ role: "user", content: "hi" }],
      max_output_tokens: 64,
      temperature: 0,
      json_mode: true,
      timeout_ms: 2000,
    });
    const firstCall = fetchImpl.mock.calls[0] as unknown as
      | [string, RequestInit]
      | undefined;
    expect(firstCall).toBeDefined();
    const body = JSON.parse(String(firstCall![1].body)) as Record<
      string,
      unknown
    >;
    expect(body.tools).toBeUndefined();
    expect(body.functions).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("classifie 401 comme auth non retryable", async () => {
    const transport = createOpenAiCompatibleTransport({
      apiKey: "sk-test",
      baseUrl: "https://example.test/v1",
      model: "gpt-test",
      fetchImpl: (async () =>
        new Response("{}", { status: 401 })) as unknown as typeof fetch,
    });
    await expect(
      transport.complete({
        messages: [{ role: "user", content: "x" }],
        max_output_tokens: 16,
        temperature: 0,
        json_mode: false,
        timeout_ms: 1000,
      }),
    ).rejects.toMatchObject({ code: "LLM_PROVIDER_AUTH", retryable: false });
  });
});

describe("Conversational extract provider wiring", () => {
  it("disabled/stub → extracteur déterministe (pas d’échec disabled)", async () => {
    const provider = resolveConversationalLlmProvider({
      env: loadLlmEnv({ SIDIAN_LLM_PROVIDER_ENABLED: "false" }),
    });
    const raw = await provider.extract({
      user_message:
        "Client Dupont, dupont@exemple.fr, 1200 EUR TTC, échéance 2026-08-01",
      reference_date: "2026-07-26",
    });
    expect(raw).toMatchObject({
      schema_version: "conversational.extraction.v1",
    });
  });
});
