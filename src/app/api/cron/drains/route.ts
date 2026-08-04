/**
 * Cron drains outbox + payment jobs — Vercel Cron + relance manuelle.
 *
 * Auth : Authorization: Bearer $CRON_SECRET
 * Déclenche des effets externes (WhatsApp / email / paiement) UNIQUEMENT
 * après auth forte. Jamais de secret en query. Aucun tenant libre.
 */

import "server-only";

import {
  handleCronRequest,
  methodNotAllowed,
} from "@/app/api/cron/_lib/handler";
import { runScheduledDrains } from "@/lib/runtime/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Pro / Enterprise : 60s. Hobby plafonne plus bas côté plateforme. */
export const maxDuration = 60;

async function handle(request: Request): Promise<Response> {
  return handleCronRequest({
    request,
    job: "drains",
    run: ({ requestId, budgetMs }) =>
      runScheduledDrains({
        requestId,
        budgetMs,
        includePaymentJobs: true,
      }),
  });
}

export async function GET(request: Request): Promise<Response> {
  return handle(request);
}

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}

export async function PUT(): Promise<Response> {
  return methodNotAllowed();
}

export async function PATCH(): Promise<Response> {
  return methodNotAllowed();
}

export async function DELETE(): Promise<Response> {
  return methodNotAllowed();
}
