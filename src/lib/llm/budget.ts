/**
 * Budgets / quotas d’usage LLM.
 * Fail-closed lorsque les plafonds sont atteints.
 *
 * Deux implémentations coexistent :
 *
 * - `memory` : compteurs dans un `Map` process-local. Suffisant en local et en
 *   test (déterministe, aucune dépendance), MAIS inexploitable en production
 *   serverless : chaque instance possède sa propre copie, donc le plafond
 *   configuré est multiplié par le nombre d’instances vivantes.
 * - `postgres` : compteurs partagés dans `public.llm_budget_counter`, incrément
 *   et vérification atomiques via `llm_budget_consume` (SECURITY DEFINER,
 *   service_role uniquement). C’est le seul mode où `SIDIAN_LLM_BUDGET_MAX_*`
 *   signifie réellement quelque chose.
 *
 * Le choix se fait par `SIDIAN_LLM_BUDGET_BACKEND` et est rapporté par
 * /api/health (diagnostic authentifié).
 */

import { createHash } from "node:crypto";

import { LlmError } from "./errors";

export type LlmBudgetLimits = {
  maxRequestsPerMinute: number;
  maxTokensPerMinute: number;
  maxRequestsPerScopePerHour: number;
};

export const LLM_BUDGET_BACKENDS = ["memory", "postgres"] as const;
export type LlmBudgetBackendId = (typeof LLM_BUDGET_BACKENDS)[number];

export type LlmBudgetSnapshot = {
  global_rpm: number;
  global_tpm: number;
  scopes: number;
};

type WindowCounter = {
  window_start_ms: number;
  count: number;
  tokens: number;
};

export type LlmBudgetTracker = {
  /** Réserve une requête ; lève LLM_BUDGET_EXCEEDED si plafond atteint. */
  consume(input: {
    scope_key?: string;
    estimated_tokens?: number;
  }): void;
  /** Enregistre l’usage réel après succès (tokens). */
  recordUsage(input: { scope_key?: string; tokens: number }): void;
  /** Snapshot tests. */
  snapshot(): LlmBudgetSnapshot;
  reset(): void;
};

/**
 * Même contrat que `LlmBudgetTracker`, mais asynchrone : un compteur partagé
 * exige un aller-retour réseau. Volontairement une interface distincte —
 * `Promise<void>` est structurellement assignable à `void` en TypeScript, donc
 * un appelant qui n’attend pas la promesse compilerait sans erreur tout en
 * perdant le fail-closed. Le type sépare les deux mondes explicitement.
 */
export type LlmDurableBudgetTracker = {
  readonly backend: LlmBudgetBackendId;
  /** true si les compteurs sont partagés entre instances. */
  readonly durable: boolean;
  consume(input: {
    scope_key?: string;
    estimated_tokens?: number;
  }): Promise<void>;
  recordUsage(input: { scope_key?: string; tokens: number }): Promise<void>;
  snapshot(): Promise<LlmBudgetSnapshot>;
  reset(): Promise<void>;
};

function windowKey(prefix: string, windowMs: number, nowMs: number): string {
  return `${prefix}:${Math.floor(nowMs / windowMs)}`;
}

/**
 * Compteur glissant approximatif par fenêtre fixe (minute / heure).
 * Suffisant pour plafonner un processus Node ; pas un quota distribué.
 */
export function createLlmBudgetTracker(
  limits: LlmBudgetLimits,
  options?: { now?: () => number },
): LlmBudgetTracker {
  const nowFn = options?.now ?? (() => Date.now());
  const minute = new Map<string, WindowCounter>();
  const hour = new Map<string, WindowCounter>();

  function getOrCreate(
    map: Map<string, WindowCounter>,
    key: string,
    nowMs: number,
  ): WindowCounter {
    const existing = map.get(key);
    if (existing) return existing;
    const created: WindowCounter = {
      window_start_ms: nowMs,
      count: 0,
      tokens: 0,
    };
    map.set(key, created);
    if (map.size > 500) {
      const cutoff = nowMs - 2 * 60 * 60 * 1000;
      for (const [k, v] of map) {
        if (v.window_start_ms < cutoff) map.delete(k);
      }
    }
    return created;
  }

  return {
    consume(input) {
      const nowMs = nowFn();
      const minuteKey = windowKey("g", 60_000, nowMs);
      const globalMinute = getOrCreate(minute, minuteKey, nowMs);

      if (globalMinute.count >= limits.maxRequestsPerMinute) {
        throw new LlmError("LLM_BUDGET_EXCEEDED", {
          message: "llm_rpm_exceeded",
        });
      }
      if (
        globalMinute.tokens + (input.estimated_tokens ?? 0) >
        limits.maxTokensPerMinute
      ) {
        throw new LlmError("LLM_BUDGET_EXCEEDED", {
          message: "llm_tpm_exceeded",
        });
      }

      if (input.scope_key) {
        const hourKey = windowKey(`s:${input.scope_key}`, 3_600_000, nowMs);
        const scopeHour = getOrCreate(hour, hourKey, nowMs);
        if (scopeHour.count >= limits.maxRequestsPerScopePerHour) {
          throw new LlmError("LLM_BUDGET_EXCEEDED", {
            message: "llm_scope_hourly_exceeded",
          });
        }
        scopeHour.count += 1;
      }

      globalMinute.count += 1;
      if (input.estimated_tokens) {
        globalMinute.tokens += input.estimated_tokens;
      }
    },

    recordUsage(input) {
      const nowMs = nowFn();
      const minuteKey = windowKey("g", 60_000, nowMs);
      const globalMinute = getOrCreate(minute, minuteKey, nowMs);
      globalMinute.tokens += Math.max(0, input.tokens);
    },

    snapshot() {
      const nowMs = nowFn();
      const minuteKey = windowKey("g", 60_000, nowMs);
      const global = minute.get(minuteKey);
      return {
        global_rpm: global?.count ?? 0,
        global_tpm: global?.tokens ?? 0,
        scopes: hour.size,
      };
    },

    reset() {
      minute.clear();
      hour.clear();
    },
  };
}

/**
 * Empreinte du scope avant tout envoi en base.
 * Le scope peut porter un identifiant de prestataire ou de conversation : il ne
 * doit jamais être persisté en clair dans une table de compteurs.
 */
export function fingerprintBudgetScope(scopeKey: string): string {
  return createHash("sha256").update(scopeKey, "utf8").digest("hex");
}

/**
 * Adaptateur mémoire → interface durable, pour le local et les tests.
 * `durable: false` : l’appelant (et /api/health) sait que le plafond n’est pas
 * partagé entre instances.
 */
export function createInMemoryDurableBudgetTracker(
  limits: LlmBudgetLimits,
  options?: { now?: () => number },
): LlmDurableBudgetTracker {
  const tracker = createLlmBudgetTracker(limits, options);

  return {
    backend: "memory",
    durable: false,
    async consume(input) {
      tracker.consume(input);
    },
    async recordUsage(input) {
      tracker.recordUsage(input);
    },
    async snapshot() {
      return tracker.snapshot();
    },
    async reset() {
      tracker.reset();
    },
  };
}

/** Résultat brut de `public.llm_budget_consume`. */
type BudgetConsumeRow = {
  allowed: boolean;
  reason: string | null;
  global_requests: number;
  global_tokens: number;
  scope_requests: number;
};

export type LlmBudgetRpcResult = {
  data: unknown;
  error: { message: string } | null;
};

/**
 * Surface minimale attendue du client Supabase service_role.
 * Volontairement structurelle : évite de coupler ce module aux types générés et
 * permet d’injecter un double en test.
 */
export type LlmBudgetRpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<LlmBudgetRpcResult>;

export type CreatePostgresBudgetTrackerOptions = {
  limits: LlmBudgetLimits;
  rpc: LlmBudgetRpc;
  /** Horloge injectée en test — sinon l’horloge Postgres fait foi. */
  now?: () => Date;
  /**
   * Notifié quand le backend est indisponible. Permet de remonter l’incident
   * (voir src/lib/observability/error-reporter) au lieu de l’avaler.
   */
  onBackendError?: (
    error: unknown,
    operation: "consume" | "record_usage",
  ) => void;
};

function parseConsumeRow(data: unknown): BudgetConsumeRow | null {
  if (typeof data !== "object" || data === null) return null;
  const row = data as Record<string, unknown>;
  if (typeof row.allowed !== "boolean") return null;
  return {
    allowed: row.allowed,
    reason: typeof row.reason === "string" ? row.reason : null,
    global_requests: Number(row.global_requests ?? 0),
    global_tokens: Number(row.global_tokens ?? 0),
    scope_requests: Number(row.scope_requests ?? 0),
  };
}

/**
 * Compteurs partagés en Postgres.
 *
 * Fail-closed : si la base est injoignable, on refuse la requête plutôt que de
 * laisser passer un appel non compté. L’erreur rendue est `LLM_INTERNAL`
 * (technique, non rejouable) et non `LLM_BUDGET_EXCEEDED` — mentir sur la cause
 * rendrait le diagnostic d’incident impossible.
 */
export function createPostgresBudgetTracker(
  options: CreatePostgresBudgetTrackerOptions,
): LlmDurableBudgetTracker {
  const { limits, rpc } = options;
  const nowIso = () => options.now?.().toISOString() ?? null;

  return {
    backend: "postgres",
    durable: true,

    async consume(input) {
      const scope = input.scope_key
        ? fingerprintBudgetScope(input.scope_key)
        : null;

      let result: LlmBudgetRpcResult;
      try {
        result = await rpc("llm_budget_consume", {
          p_scope_fingerprint: scope,
          p_estimated_tokens: Math.max(0, input.estimated_tokens ?? 0),
          p_max_requests_per_minute: limits.maxRequestsPerMinute,
          p_max_tokens_per_minute: limits.maxTokensPerMinute,
          p_max_requests_per_scope_per_hour: limits.maxRequestsPerScopePerHour,
          p_now: nowIso(),
        });
      } catch (error) {
        options.onBackendError?.(error, "consume");
        throw new LlmError("LLM_INTERNAL", {
          message: "llm_budget_backend_unavailable",
          cause: error,
        });
      }

      if (result.error) {
        options.onBackendError?.(result.error, "consume");
        throw new LlmError("LLM_INTERNAL", {
          message: "llm_budget_backend_unavailable",
        });
      }

      const row = parseConsumeRow(result.data);
      if (!row) {
        options.onBackendError?.(
          new Error("llm_budget_response_malformed"),
          "consume",
        );
        throw new LlmError("LLM_INTERNAL", {
          message: "llm_budget_backend_unavailable",
        });
      }

      if (!row.allowed) {
        throw new LlmError("LLM_BUDGET_EXCEEDED", {
          message: row.reason ?? "llm_budget_exceeded",
        });
      }
    },

    async recordUsage(input) {
      // Comptabilité a posteriori : une panne ici ne doit pas invalider une
      // réponse déjà rendue. On remonte l’incident, on ne lève pas.
      try {
        const result = await rpc("llm_budget_record_usage", {
          p_tokens: Math.max(0, input.tokens),
          p_now: nowIso(),
        });
        if (result.error) {
          options.onBackendError?.(result.error, "record_usage");
        }
      } catch (error) {
        options.onBackendError?.(error, "record_usage");
      }
    },

    async snapshot() {
      // Le backend Postgres n’expose pas d’instantané agrégé : la valeur utile
      // est renvoyée par `consume` à chaque appel. Un instantané local n’aurait
      // aucun sens ici, on ne prétend donc rien mesurer.
      return { global_rpm: 0, global_tpm: 0, scopes: 0 };
    },

    async reset() {
      // Pas de remise à zéro globale : les fenêtres expirent d’elles-mêmes et
      // sont supprimées par `purge_expired_llm_budget_counters`.
    },
  };
}

/**
 * Lit `SIDIAN_LLM_BUDGET_BACKEND`. Défaut `memory` : on n’impose jamais
 * silencieusement une dépendance base à un environnement local ou de test.
 */
export function resolveLlmBudgetBackend(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): LlmBudgetBackendId {
  const raw = env.SIDIAN_LLM_BUDGET_BACKEND?.trim().toLowerCase();
  return raw === "postgres" ? "postgres" : "memory";
}

export type LlmBudgetBackendReport = {
  backend: LlmBudgetBackendId;
  /** true uniquement si les compteurs sont partagés entre instances. */
  durable: boolean;
  /** true si la variable a été explicitement renseignée. */
  explicitly_configured: boolean;
  limits: LlmBudgetLimits | null;
};

/** Diagnostic /api/health : quel backend de budget est réellement actif. */
export function describeLlmBudgetBackend(input?: {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  limits?: LlmBudgetLimits;
}): LlmBudgetBackendReport {
  const env = input?.env ?? process.env;
  const backend = resolveLlmBudgetBackend(env);
  return {
    backend,
    durable: backend === "postgres",
    explicitly_configured: Boolean(env.SIDIAN_LLM_BUDGET_BACKEND?.trim()),
    limits: input?.limits ?? null,
  };
}
