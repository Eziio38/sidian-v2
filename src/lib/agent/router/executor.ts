/**
 * Contrat exécuteur injecté (G1-D).
 * Le Router n’appelle jamais Stripe / Supabase / Domain Service directement.
 */

import type {
  ToolRouteActor,
  ToolRouteResource,
  ToolRouteTenant,
} from "./types";

export type ToolExecutorInput = {
  arguments: unknown;
  actor: ToolRouteActor;
  tenant: ToolRouteTenant;
  resource?: ToolRouteResource;
  correlation_id: string;
};

export type ToolExecutor = {
  execute(input: ToolExecutorInput): Promise<unknown>;
};

/**
 * Résolution d’exécuteur hors requête — l’appelant ne peut pas
 * fournir un exécuteur dans ToolRouteRequest.
 */
export type ResolveToolExecutor = (
  toolId: string,
  toolVersion: string,
) => ToolExecutor | undefined;

export type ToolExecutorErrorCategory = "technical" | "business";

/**
 * Erreur typée renvoyée / levée par un exécuteur.
 * Sans stack exposée au résultat Router.
 */
export class ToolExecutorError extends Error {
  readonly category: ToolExecutorErrorCategory;
  readonly code: string;
  readonly userMessage: string;

  constructor(input: {
    category: ToolExecutorErrorCategory;
    code: string;
    message: string;
    userMessage?: string;
  }) {
    super(input.message);
    this.name = "ToolExecutorError";
    this.category = input.category;
    this.code = input.code;
    this.userMessage =
      input.userMessage ??
      (input.category === "business"
        ? "L’action n’a pas pu aboutir."
        : "Une erreur technique est survenue.");
  }
}

export function isToolExecutorError(
  value: unknown,
): value is ToolExecutorError {
  return value instanceof ToolExecutorError;
}

/**
 * Détecte une erreur métier/technique structurée (objet plain)
 * sans exposer de détails arbitraires.
 */
export function asTypedExecutorFailure(value: unknown): {
  category: ToolExecutorErrorCategory;
  code: string;
  message: string;
} | null {
  if (isToolExecutorError(value)) {
    return {
      category: value.category,
      code: value.code,
      message: value.userMessage || value.message,
    };
  }
  if (value === null || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const category = record.category;
  const code = record.code;
  if (
    (category !== "technical" && category !== "business") ||
    typeof code !== "string" ||
    code.length === 0
  ) {
    return null;
  }
  const message =
    typeof record.user_message === "string" && record.user_message.length > 0
      ? record.user_message
      : typeof record.message === "string" && record.message.length > 0
        ? record.message
        : category === "business"
          ? "L’action n’a pas pu aboutir."
          : "Une erreur technique est survenue.";
  return { category, code, message };
}
