/**
 * Exécuteurs mémoire / spy G1-D — résultats métier, techniques et erreurs typées.
 */

import {
  ToolExecutorError,
  type ToolExecutor,
  type ToolExecutorInput,
} from "@/lib/agent/router";

import type { CallLog } from "./call-log";
import {
  CORRELATION_ID,
  INVOICE_1,
  SENSITIVE_RAW_FIELD,
  SENSITIVE_RAW_TOKEN,
} from "./constants";

export type ToolExecutorExecuteInput = ToolExecutorInput;

export type { ToolExecutor };

export type SpyToolExecutor = ToolExecutor & {
  calls: ToolExecutorExecuteInput[];
  callCount: () => number;
  reset: () => void;
};

export type ExecutorResolver = (
  toolId: string,
  toolVersion: string,
) => ToolExecutor | undefined;

export type MemoryExecutorResolver = ExecutorResolver & {
  setExecutor: (
    toolId: string,
    toolVersion: string,
    executor: ToolExecutor | undefined,
  ) => void;
  clear: () => void;
  resolveCalls: Array<{ tool_id: string; tool_version: string }>;
};

/** Erreur technique typée via contrat production. */
export function createTechnicalExecutorError(
  code = "EXECUTOR_TIMEOUT",
  message = "timeout simulateur",
): ToolExecutorError {
  return new ToolExecutorError({
    category: "technical",
    code,
    message,
    userMessage: "Une erreur technique est survenue.",
  });
}

/** Erreur métier typée via contrat production. */
export function createBusinessExecutorError(
  code = "INVOICE_NOT_FOUND",
  message = "facture introuvable",
): ToolExecutorError {
  return new ToolExecutorError({
    category: "business",
    code,
    message,
    userMessage: "L’action n’a pas pu aboutir.",
  });
}

/** Sortie nominale invoice.get conforme au schéma G1-B. */
export function validInvoiceGetOutput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    invoice_id: INVOICE_1,
    amount_cents: 12_000,
    currency: "EUR",
    status: "open",
    ...overrides,
  };
}

/** Sortie nominale payment.create_attempt conforme au schéma G1-B. */
export function validPaymentCreateAttemptOutput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    status: "pending",
    payment_attempt_id: "pay_att_001",
    provider_status: "processing",
    ...overrides,
  };
}

/** Sortie invalide (champs manquants / types incorrects). */
export function invalidInvoiceGetOutput(): Record<string, unknown> {
  return {
    invoice_id: INVOICE_1,
    // amount_cents manquant + currency invalide
    currency: "USD",
  };
}

/** Sortie brute sensible — ne doit pas être reprise telle quelle en erreur. */
export function sensitiveInvalidOutput(): Record<string, unknown> {
  return {
    invoice_id: INVOICE_1,
    [SENSITIVE_RAW_FIELD]: "4111111111111111",
    secret_token: SENSITIVE_RAW_TOKEN,
    // volontairement hors contrat
    extra_ledger: [{ secret: SENSITIVE_RAW_TOKEN }],
  };
}

export function createSpyExecutor(options?: {
  result?: unknown | (() => unknown) | (() => Promise<unknown>);
  error?: unknown | (() => unknown);
  callLog?: CallLog;
  toolId?: string;
  toolVersion?: string;
}): SpyToolExecutor {
  const calls: ToolExecutorExecuteInput[] = [];
  const toolId = options?.toolId ?? "invoice.get";
  const toolVersion = options?.toolVersion ?? "1.0.0";

  return {
    calls,
    callCount: () => calls.length,
    reset: () => {
      calls.length = 0;
    },
    async execute(input: ToolExecutorExecuteInput): Promise<unknown> {
      calls.push(structuredClone(input) as ToolExecutorExecuteInput);
      options?.callLog?.recordExecutor(toolId, toolVersion);

      if (options?.error !== undefined) {
        const thrown =
          typeof options.error === "function"
            ? (options.error as () => unknown)()
            : options.error;
        throw thrown;
      }

      if (typeof options?.result === "function") {
        return await (options.result as () => unknown | Promise<unknown>)();
      }
      return options?.result ?? validInvoiceGetOutput();
    },
  };
}

export function createMemoryExecutorResolver(
  initial?: Array<{
    tool_id: string;
    tool_version: string;
    executor: ToolExecutor;
  }>,
): MemoryExecutorResolver {
  const map = new Map<string, ToolExecutor>();
  const resolveCalls: MemoryExecutorResolver["resolveCalls"] = [];

  for (const entry of initial ?? []) {
    map.set(`${entry.tool_id}@${entry.tool_version}`, entry.executor);
  }

  const resolve: MemoryExecutorResolver = Object.assign(
    (toolId: string, toolVersion: string) => {
      resolveCalls.push({ tool_id: toolId, tool_version: toolVersion });
      return map.get(`${toolId}@${toolVersion}`);
    },
    {
      setExecutor(
        toolId: string,
        toolVersion: string,
        executor: ToolExecutor | undefined,
      ) {
        const key = `${toolId}@${toolVersion}`;
        if (executor === undefined) map.delete(key);
        else map.set(key, executor);
      },
      clear() {
        map.clear();
        resolveCalls.length = 0;
      },
      resolveCalls,
    },
  );

  return resolve;
}

/** Exécuteur qui ignore l’input et renvoie une sortie fixe (déterminisme). */
export function createFixedResultExecutor(
  result: unknown,
  callLog?: CallLog,
  toolMeta?: { tool_id: string; tool_version: string },
): SpyToolExecutor {
  return createSpyExecutor({
    result,
    callLog,
    toolId: toolMeta?.tool_id ?? "invoice.get",
    toolVersion: toolMeta?.tool_version ?? "1.0.0",
  });
}

export const defaultExecutorCorrelationProbe = CORRELATION_ID;
