/**
 * Handler HTTP partagé pour les routes cron Vercel.
 *
 * - Auth Bearer CRON_SECRET (jamais en query)
 * - GET (Vercel Cron) + POST (relance manuelle idempotente)
 * - Réponse synthétique sans secrets
 */

import "server-only";

import { createRequestId, requestIdFromHeaders } from "@/lib/observability/request-id";
import { logServerEvent } from "@/lib/observability/server-logger";
import {
  assertCronAuthorized,
  DEFAULT_CRON_BUDGET_MS,
} from "@/lib/runtime/cron";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
} as const;

export async function handleCronRequest(params: {
  request: Request;
  job: "scanners" | "drains";
  run: (ctx: {
    requestId: string;
    budgetMs: number;
  }) => Promise<{ ok: boolean; status: string } & Record<string, unknown>>;
}): Promise<Response> {
  const requestId =
    requestIdFromHeaders(params.request.headers) ?? createRequestId();

  const auth = assertCronAuthorized(params.request);
  if (!auth.ok) {
    logServerEvent("warn", "scanner_started", {
      requestId,
      job: params.job,
      authError: auth.error,
    });
    return Response.json(
      { ok: false, error: auth.error, requestId },
      { status: auth.status, headers: NO_STORE_HEADERS },
    );
  }

  // Ignore body tenant / free-form scope — cron est global service_role.
  if (params.request.method === "POST") {
    try {
      // Consume body without trusting it (size-bounded best-effort).
      await params.request.text();
    } catch {
      // ignore
    }
  }

  try {
    const body = await params.run({
      requestId,
      budgetMs: DEFAULT_CRON_BUDGET_MS,
    });
    const httpStatus = body.ok ? 200 : body.status === "failed" ? 500 : 200;
    return Response.json(body, {
      status: httpStatus,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    const reasonCode =
      error instanceof Error ? error.message.slice(0, 80) : "cron_handler_failed";
    logServerEvent("error", "scanner_completed", {
      requestId,
      job: params.job,
      reasonCode,
    });
    return Response.json(
      {
        ok: false,
        job: params.job,
        requestId,
        status: "failed",
        error: "cron_execution_failed",
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

export function methodNotAllowed(): Response {
  return Response.json(
    { ok: false, error: "method_not_allowed" },
    { status: 405, headers: { ...NO_STORE_HEADERS, Allow: "GET, POST" } },
  );
}
