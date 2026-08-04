import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createInMemoryDurableBudgetTracker,
  createLlmBudgetTracker,
  createPostgresBudgetTracker,
  describeLlmBudgetBackend,
  fingerprintBudgetScope,
  resolveLlmBudgetBackend,
  type LlmBudgetRpcResult,
} from "./budget";
import { isLlmError, LlmError } from "./errors";

const LIMITS = {
  maxRequestsPerMinute: 3,
  maxTokensPerMinute: 1_000,
  maxRequestsPerScopePerHour: 2,
};

function expectLlmError(fn: () => unknown, code: string, message: string) {
  try {
    fn();
  } catch (error) {
    expect(isLlmError(error)).toBe(true);
    expect((error as LlmError).code).toBe(code);
    expect((error as LlmError).message).toBe(message);
    return;
  }
  throw new Error("aucune erreur levée");
}

describe("compteur mémoire (repli local / test)", () => {
  it("plafonne les requêtes par minute", () => {
    const tracker = createLlmBudgetTracker(LIMITS, { now: () => 0 });
    tracker.consume({});
    tracker.consume({});
    tracker.consume({});
    expectLlmError(() => tracker.consume({}), "LLM_BUDGET_EXCEEDED", "llm_rpm_exceeded");
  });

  it("plafonne les tokens par minute", () => {
    const tracker = createLlmBudgetTracker(LIMITS, { now: () => 0 });
    expectLlmError(
      () => tracker.consume({ estimated_tokens: 1_001 }),
      "LLM_BUDGET_EXCEEDED",
      "llm_tpm_exceeded",
    );
  });

  it("plafonne les requêtes par scope et par heure", () => {
    let now = 0;
    const tracker = createLlmBudgetTracker(LIMITS, { now: () => now });
    tracker.consume({ scope_key: "p1" });
    now = 61_000; // nouvelle minute, même heure
    tracker.consume({ scope_key: "p1" });
    now = 122_000;
    expectLlmError(
      () => tracker.consume({ scope_key: "p1" }),
      "LLM_BUDGET_EXCEEDED",
      "llm_scope_hourly_exceeded",
    );
  });

  it("expose un instantané et se réinitialise", () => {
    const tracker = createLlmBudgetTracker(LIMITS, { now: () => 0 });
    tracker.consume({ scope_key: "p1", estimated_tokens: 10 });
    tracker.recordUsage({ tokens: 40 });
    expect(tracker.snapshot()).toEqual({
      global_rpm: 1,
      global_tpm: 50,
      scopes: 1,
    });
    tracker.reset();
    expect(tracker.snapshot()).toEqual({
      global_rpm: 0,
      global_tpm: 0,
      scopes: 0,
    });
  });

  it("s'annonce comme non durable via l'adaptateur asynchrone", async () => {
    const tracker = createInMemoryDurableBudgetTracker(LIMITS, { now: () => 0 });
    expect(tracker.backend).toBe("memory");
    expect(tracker.durable).toBe(false);

    await tracker.consume({});
    await tracker.consume({});
    await tracker.consume({});
    await expect(tracker.consume({})).rejects.toMatchObject({
      code: "LLM_BUDGET_EXCEEDED",
    });
  });
});

describe("empreinte de scope", () => {
  it("produit 64 caractères hexadécimaux stables", () => {
    const fingerprint = fingerprintBudgetScope("prestataire:42");
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintBudgetScope("prestataire:42")).toBe(fingerprint);
    expect(fingerprintBudgetScope("prestataire:43")).not.toBe(fingerprint);
  });

  it("ne laisse jamais fuiter le scope en clair", () => {
    expect(fingerprintBudgetScope("payeur@exemple.test")).not.toContain("@");
  });
});

function okResult(row: Record<string, unknown>): LlmBudgetRpcResult {
  return { data: row, error: null };
}

describe("compteur Postgres (partagé entre instances)", () => {
  it("hache le scope et transmet les plafonds configurés", async () => {
    const rpc = vi.fn(async () =>
      okResult({
        allowed: true,
        reason: null,
        global_requests: 1,
        global_tokens: 200,
        scope_requests: 1,
      }),
    );
    const tracker = createPostgresBudgetTracker({
      limits: LIMITS,
      rpc,
      now: () => new Date("2026-08-03T10:00:00.000Z"),
    });

    expect(tracker.backend).toBe("postgres");
    expect(tracker.durable).toBe(true);

    await tracker.consume({ scope_key: "prestataire:42", estimated_tokens: 200 });

    expect(rpc).toHaveBeenCalledWith("llm_budget_consume", {
      p_scope_fingerprint: fingerprintBudgetScope("prestataire:42"),
      p_estimated_tokens: 200,
      p_max_requests_per_minute: 3,
      p_max_tokens_per_minute: 1_000,
      p_max_requests_per_scope_per_hour: 2,
      p_now: "2026-08-03T10:00:00.000Z",
    });
  });

  it("propage le motif de refus rendu par la base", async () => {
    const tracker = createPostgresBudgetTracker({
      limits: LIMITS,
      rpc: async () =>
        okResult({
          allowed: false,
          reason: "llm_scope_hourly_exceeded",
          global_requests: 1,
          global_tokens: 0,
          scope_requests: 2,
        }),
    });

    await expect(tracker.consume({ scope_key: "p1" })).rejects.toMatchObject({
      code: "LLM_BUDGET_EXCEEDED",
      message: "llm_scope_hourly_exceeded",
    });
  });

  it("échoue fermé et signale l'incident quand la base est injoignable", async () => {
    const reported: Array<{ operation: string }> = [];
    const tracker = createPostgresBudgetTracker({
      limits: LIMITS,
      rpc: async () => {
        throw new Error("connection refused");
      },
      onBackendError: (_error, operation) => reported.push({ operation }),
    });

    // LLM_INTERNAL et non LLM_BUDGET_EXCEEDED : la cause réelle est une panne,
    // pas un plafond atteint.
    await expect(tracker.consume({})).rejects.toMatchObject({
      code: "LLM_INTERNAL",
      message: "llm_budget_backend_unavailable",
    });
    expect(reported).toEqual([{ operation: "consume" }]);
  });

  it("échoue fermé sur erreur RPC renvoyée sans exception", async () => {
    const tracker = createPostgresBudgetTracker({
      limits: LIMITS,
      rpc: async () => ({ data: null, error: { message: "permission denied" } }),
    });

    await expect(tracker.consume({})).rejects.toMatchObject({
      code: "LLM_INTERNAL",
    });
  });

  it("échoue fermé sur réponse malformée", async () => {
    const tracker = createPostgresBudgetTracker({
      limits: LIMITS,
      rpc: async () => ({ data: { unexpected: true }, error: null }),
    });

    await expect(tracker.consume({})).rejects.toMatchObject({
      code: "LLM_INTERNAL",
    });
  });

  it("n'invalide pas une réponse déjà rendue si l'enregistrement d'usage échoue", async () => {
    const reported: string[] = [];
    const tracker = createPostgresBudgetTracker({
      limits: LIMITS,
      rpc: async () => {
        throw new Error("timeout");
      },
      onBackendError: (_error, operation) => reported.push(operation),
    });

    await expect(
      tracker.recordUsage({ tokens: 120 }),
    ).resolves.toBeUndefined();
    expect(reported).toEqual(["record_usage"]);
  });

  it("borne les tokens négatifs à zéro", async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const tracker = createPostgresBudgetTracker({
      limits: LIMITS,
      rpc: async (fn, args) => {
        calls.push({ fn, args });
        return okResult({ allowed: true });
      },
    });

    await tracker.consume({ estimated_tokens: -50 });
    await tracker.recordUsage({ tokens: -10 });

    expect(calls[0].args).toMatchObject({ p_estimated_tokens: 0 });
    expect(calls[1].args).toMatchObject({ p_tokens: 0 });
  });
});

describe("sélection du backend", () => {
  const original = process.env.SIDIAN_LLM_BUDGET_BACKEND;

  afterEach(() => {
    if (original === undefined) delete process.env.SIDIAN_LLM_BUDGET_BACKEND;
    else process.env.SIDIAN_LLM_BUDGET_BACKEND = original;
  });

  it("retombe sur la mémoire par défaut", () => {
    expect(resolveLlmBudgetBackend({})).toBe("memory");
    expect(resolveLlmBudgetBackend({ SIDIAN_LLM_BUDGET_BACKEND: "" })).toBe(
      "memory",
    );
    expect(
      resolveLlmBudgetBackend({ SIDIAN_LLM_BUDGET_BACKEND: "redis" }),
    ).toBe("memory");
  });

  it("sélectionne Postgres sur configuration explicite", () => {
    expect(
      resolveLlmBudgetBackend({ SIDIAN_LLM_BUDGET_BACKEND: " Postgres " }),
    ).toBe("postgres");
  });

  it("décrit le backend actif pour la sonde de santé", () => {
    expect(describeLlmBudgetBackend({ env: {} })).toEqual({
      backend: "memory",
      durable: false,
      explicitly_configured: false,
      limits: null,
    });

    expect(
      describeLlmBudgetBackend({
        env: { SIDIAN_LLM_BUDGET_BACKEND: "postgres" },
        limits: LIMITS,
      }),
    ).toEqual({
      backend: "postgres",
      durable: true,
      explicitly_configured: true,
      limits: LIMITS,
    });
  });
});
