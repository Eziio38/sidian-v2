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
import { createAgentPersistenceClient } from "@/lib/agent/server/auth/service-role";
import {
  assertConversationScope,
  attachConversationToClient,
  persistConversationTurn,
} from "@/lib/assistant-conversations";
import { resolveAssistantConversationRequestContext } from "@/lib/assistant-conversations/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AgentRequestPreview = {
  tool_id?: unknown;
  arguments?: unknown;
};

type ConversationPersistenceIntent =
  | {
      kind: "turn";
      conversationId: string;
      userContent: string;
    }
  | {
      kind: "confirm";
      draftId: string;
    };

const SAFE_SAVE_MESSAGE = "Je n’ai pas pu enregistrer ta demande.";

async function inspectConversationIntent(
  request: Request,
): Promise<ConversationPersistenceIntent | null> {
  try {
    const body = (await request.clone().json()) as AgentRequestPreview;
    if (
      !body.arguments ||
      typeof body.arguments !== "object" ||
      Array.isArray(body.arguments)
    ) {
      return null;
    }
    const args = body.arguments as Record<string, unknown>;
    if (
      body.tool_id === "protection.draft.converse" &&
      typeof args.conversation_id === "string" &&
      typeof args.message === "string"
    ) {
      return {
        kind: "turn",
        conversationId: args.conversation_id,
        userContent: args.message,
      };
    }
    if (
      body.tool_id === "protection.draft.confirm" &&
      typeof args.draft_id === "string"
    ) {
      return { kind: "confirm", draftId: args.draft_id };
    }
    return null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function buildPersistedAssistantContent(output: Record<string, unknown>): string {
  const pendingQuestion =
    typeof output.pending_question === "string"
      ? output.pending_question.trim()
      : "";
  const summary =
    typeof output.summary === "string" ? output.summary.trim() : "";
  const missingFields = Array.isArray(output.missing_fields)
    ? output.missing_fields
    : [];
  const confirmationNonce =
    typeof output.confirmation_nonce === "string"
      ? output.confirmation_nonce.trim()
      : "";
  const parts = [pendingQuestion || summary || "J’ai noté ta demande."];
  if (missingFields.length === 0 && confirmationNonce && pendingQuestion && summary) {
    parts.push(summary);
  }
  if (
    missingFields.length === 0 &&
    confirmationNonce &&
    !parts.some((part) => /confirm/i.test(part))
  ) {
    parts.push("Rien ne sera envoyé avant ta confirmation.");
  }
  return parts.join("\n\n");
}

function persistenceFailureResponse(
  source?: Record<string, unknown>,
): Response {
  return Response.json(
    {
      request_id:
        typeof source?.request_id === "string" ? source.request_id : "",
      correlation_id:
        typeof source?.correlation_id === "string"
          ? source.correlation_id
          : "",
      status: "error",
      code: "CONVERSATION_SAVE_FAILED",
      data: { message: SAFE_SAVE_MESSAGE },
      degraded: { observability: false },
    },
    { status: 503 },
  );
}

export async function POST(request: Request): Promise<Response> {
  const intent = await inspectConversationIntent(request);
  const context = intent
    ? await resolveAssistantConversationRequestContext()
    : null;
  const admin =
    intent && context ? await createAgentPersistenceClient() : null;

  if (intent?.kind === "turn") {
    if (
      !context ||
      !admin ||
      !(await assertConversationScope({
        admin,
        prestataireId: context.prestataire.id,
        conversationId: intent.conversationId,
      }))
    ) {
      return persistenceFailureResponse();
    }
  }

  const handler = await createAgentToolsRouteHandler(request);
  const response = await handler(request);
  if (!intent || !context || !admin || !response.ok) return response;

  let body: Record<string, unknown>;
  try {
    body = (await response.clone().json()) as Record<string, unknown>;
  } catch {
    return persistenceFailureResponse();
  }
  const data = asRecord(body.data);
  const output = asRecord(data?.output);
  if (!output) return response;

  try {
    if (intent.kind === "turn") {
      await persistConversationTurn({
        admin,
        prestataireId: context.prestataire.id,
        conversationId: intent.conversationId,
        userContent: intent.userContent,
        assistantContent: buildPersistedAssistantContent(output),
      });
    } else {
      const clientId =
        typeof output.client_payeur_id === "string"
          ? output.client_payeur_id
          : null;
      if (!clientId) return response;
      const { data: draft } = await admin
        .from("agent_protection_drafts")
        .select("conversation_id")
        .eq("draft_id", intent.draftId)
        .eq("tenant_id", context.prestataire.id)
        .maybeSingle();
      if (draft?.conversation_id) {
        await attachConversationToClient({
          admin,
          prestataireId: context.prestataire.id,
          conversationId: draft.conversation_id,
          clientId,
        });
      }
    }
  } catch {
    return persistenceFailureResponse(body);
  }

  return response;
}
