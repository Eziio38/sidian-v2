/**
 * Bascule explicite et bornée entre deux transports live.
 *
 * Règles :
 * - une seule tentative de secours par appel (aucune cascade) ;
 * - bascule UNIQUEMENT sur une panne de transport retryable (réseau, 5xx,
 *   rate limit) — jamais sur un refus du modèle, une erreur de validation,
 *   une erreur d'authentification ni une erreur de configuration ;
 * - jamais de bascule si le signal de l'appelant est déjà avorté : le budget
 *   temps de la requête est épuisé, relancer un second provider le
 *   dépasserait silencieusement. Le retry du runtime reprend la main.
 * - le provider qui a servi la requête est journalisé (identifiant + modèle,
 *   jamais de clé).
 */

import "server-only";

import { logServerEvent } from "@/lib/observability/server-logger";

import type { LlmErrorCode } from "../errors";
import type { LlmTransport } from "../types";

import { normalizeLlmTransportError } from "./http-errors";

export type LlmFailoverEvent = {
  provider_id: string;
  role: "primary" | "fallback";
  ok: boolean;
  error_code?: LlmErrorCode;
};

export type CreateFailoverLlmTransportOptions = {
  primary: LlmTransport;
  /** Absent → le transport se comporte exactement comme le primaire. */
  fallback?: LlmTransport;
  /** Injecté pour tests ; défaut = log serveur rédigé. */
  onProviderServed?: (event: LlmFailoverEvent) => void;
};

function defaultOnProviderServed(event: LlmFailoverEvent): void {
  logServerEvent(event.ok ? "info" : "warn", "llm.provider_attempt", {
    provider_id: event.provider_id,
    role: event.role,
    ok: event.ok,
    error_code: event.error_code ?? null,
  });
}

export function createFailoverLlmTransport(
  options: CreateFailoverLlmTransportOptions,
): LlmTransport {
  const { primary, fallback } = options;
  const notify = options.onProviderServed ?? defaultOnProviderServed;

  if (!fallback) return primary;

  return {
    provider_id: `failover:${primary.provider_id}|${fallback.provider_id}`,
    mode: primary.mode,
    async complete(input) {
      try {
        const result = await primary.complete(input);
        notify({ provider_id: primary.provider_id, role: "primary", ok: true });
        return result;
      } catch (err) {
        const primaryError = normalizeLlmTransportError(err);
        notify({
          provider_id: primary.provider_id,
          role: "primary",
          ok: false,
          error_code: primaryError.code,
        });

        if (!primaryError.retryable || input.signal?.aborted) {
          throw primaryError;
        }

        try {
          const result = await fallback.complete(input);
          notify({
            provider_id: fallback.provider_id,
            role: "fallback",
            ok: true,
          });
          return result;
        } catch (fallbackErr) {
          const fallbackError = normalizeLlmTransportError(fallbackErr);
          notify({
            provider_id: fallback.provider_id,
            role: "fallback",
            ok: false,
            error_code: fallbackError.code,
          });
          throw fallbackError;
        }
      }
    },
  };
}
