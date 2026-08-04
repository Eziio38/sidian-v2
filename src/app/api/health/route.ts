/**
 * Sonde de santé.
 *
 * Deux réponses distinctes :
 *
 * - publique : `{ status, app }` seuls. La version précédente exposait sans
 *   aucune authentification l'environnement de déploiement et l'état de la
 *   base ; c'est de la reconnaissance offerte (savoir qu'une preview tourne, ou
 *   que la base est tombée, oriente la suite d'une attaque).
 * - diagnostic : derrière `Authorization: Bearer $CRON_SECRET`, la même
 *   authentification que les routes cron. Uniquement des booléens de présence
 *   de clés, jamais une valeur de secret.
 */

import { NextResponse } from "next/server";

import { getAppEnvironment } from "@/config/env-shared";
import {
  checkDatabaseHealth,
  type DatabaseHealthStatus,
} from "@/lib/health/check-database";
import { describeLlmBudgetBackend } from "@/lib/llm/budget";
import { describeLlmHealth } from "@/lib/llm/health";
import {
  describeErrorReporting,
  reportError,
} from "@/lib/observability/error-reporter";
import { assertCronAuthorized } from "@/lib/runtime/cron/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const NO_STORE = "private, no-store, max-age=0, must-revalidate";

export function isHealthOperational(
  database: DatabaseHealthStatus,
  environment: string,
): boolean {
  return (
    database === "connected" ||
    (database === "not_configured" && environment === "local")
  );
}

/**
 * Tête de migration appliquée. Diagnostic pur : une base injoignable rend
 * `null`, jamais une erreur — la sonde ne doit pas tomber avec la dépendance
 * qu'elle observe. L'incident est remonté au collecteur au lieu d'être avalé.
 */
async function readMigrationHead(): Promise<string | null> {
  try {
    const admin = await createAdminClient();
    const { data, error } = await admin.rpc("schema_migration_head");
    if (error) {
      reportError(error, { scope: "api.health", severity: "warning" });
      return null;
    }
    return typeof data === "string" ? data : null;
  } catch (error) {
    reportError(error, { scope: "api.health", severity: "warning" });
    return null;
  }
}

export async function GET(request: Request) {
  const database = await checkDatabaseHealth();
  const environment = getAppEnvironment();
  const isOperational = isHealthOperational(database, environment);
  const status = isOperational ? "ok" : "unavailable";
  const httpStatus = isOperational ? 200 : 503;

  const authorization = assertCronAuthorized(request);
  if (!authorization.ok) {
    // Réponse publique : le strict minimum. Aucun indice non plus sur la raison
    // du refus — un appelant non autorisé ne doit pas pouvoir distinguer
    // « CRON_SECRET absent » de « CRON_SECRET faux ».
    return NextResponse.json(
      { status, app: "sidian-v2" },
      { status: httpStatus, headers: { "Cache-Control": NO_STORE } },
    );
  }

  const llm = describeLlmHealth();
  const budget = describeLlmBudgetBackend();
  const errorReporting = describeErrorReporting();
  const migrationHead = await readMigrationHead();

  return NextResponse.json(
    {
      status,
      app: "sidian-v2",
      environment,
      database,
      migration_head: migrationHead,
      llm: {
        enabled: llm.enabled,
        mode: llm.mode,
        provider: llm.provider,
        model: llm.model,
        api_key_present: llm.api_key_present,
        fallback_provider: llm.fallback_provider,
        fallback_model: llm.fallback_model,
        fallback_api_key_present: llm.fallback_api_key_present,
        streaming: llm.streaming,
      },
      llm_budget: {
        backend: budget.backend,
        durable: budget.durable,
        explicitly_configured: budget.explicitly_configured,
      },
      error_reporting: {
        backend: errorReporting.backend,
        provider: errorReporting.provider,
        configured: errorReporting.configured,
      },
    },
    { status: httpStatus, headers: { "Cache-Control": NO_STORE } },
  );
}
