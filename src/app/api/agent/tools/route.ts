/**
 * Point d’entrée HTTP canonique Agent — `POST /api/agent/tools` (G1-L).
 *
 * Chaîne obligatoire :
 * HTTP → AuthMaterial (headers/cookies) → RequestGateway →
 * TrustedExecutionContext → ToolRouter → réponse sanitizée.
 *
 * Interdit : TrustedExecutionContext / tenant / actor / grants depuis le body.
 *
 * ## service_role
 * Voir `src/lib/agent/server/auth/service-role.ts`.
 * Auth/membership = client user ; audit/idempotency/approvals = admin.
 *
 * Next.js App Router : seuls les handlers exportés sont exposés ;
 * les autres méthodes reçoivent 405 sans câbler Gateway/Router.
 */

import "server-only";

import { createAgentToolsRouteHandler } from "@/lib/agent/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const handler = await createAgentToolsRouteHandler(request);
  return handler(request);
}
