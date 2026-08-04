import "server-only";

import { z } from "zod";

import {
  assignConversationToProject,
  attachConversationToClient,
  deleteConversation,
  loadConversationMessages,
  persistConversationTurn,
  renameConversation,
} from "@/lib/assistant-conversations";
import { resolveAssistantConversationRequestContext } from "@/lib/assistant-conversations/request-context";
import { createAgentPersistenceClient } from "@/lib/agent/server/auth/service-role";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConversationRouteContext = {
  params: Promise<{ id: string }>;
};

const uuidSchema = z.string().uuid();
const patchSchema = z
  .object({
    clientId: z.string().uuid().nullable().optional(),
    projectId: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(1).max(80).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.clientId !== undefined ||
      value.projectId !== undefined ||
      value.title !== undefined,
    { message: "empty_patch" },
  );
const messageTurnSchema = z
  .object({
    userContent: z.string().trim().min(1).max(8_000),
    assistantContent: z.string().trim().min(1).max(8_000),
  })
  .strict();
const SAFE_ERROR = "Je n’ai pas pu enregistrer ta demande.";
const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};

export async function GET(
  _request: Request,
  routeContext: ConversationRouteContext,
): Promise<Response> {
  try {
    const { id } = await routeContext.params;
    if (!uuidSchema.safeParse(id).success) {
      return Response.json(
        { message: "Discussion introuvable." },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    const context = await resolveAssistantConversationRequestContext();
    if (!context) {
      return Response.json(
        { message: "Authentification requise." },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }
    const messages = await loadConversationMessages(
      context.supabase,
      context.prestataire.id,
      id,
    );
    if (!messages) {
      return Response.json(
        { message: "Discussion introuvable." },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    return Response.json({ id, messages }, { headers: NO_STORE_HEADERS });
  } catch {
    return Response.json(
      { message: SAFE_ERROR },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}

export async function PATCH(
  request: Request,
  routeContext: ConversationRouteContext,
): Promise<Response> {
  try {
    const { id } = await routeContext.params;
    if (!uuidSchema.safeParse(id).success) {
      return Response.json(
        { message: "Discussion introuvable." },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        { message: SAFE_ERROR },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    const context = await resolveAssistantConversationRequestContext();
    if (!context) {
      return Response.json(
        { message: "Authentification requise." },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }
    const admin = await createAgentPersistenceClient();
    const organization: {
      clientId?: string | null;
      clientName?: string | null;
      projectId?: string | null;
      projectName?: string | null;
    } = {};
    if (parsed.data.clientId !== undefined) {
      Object.assign(
        organization,
        await attachConversationToClient({
          admin,
          prestataireId: context.prestataire.id,
          conversationId: id,
          clientId: parsed.data.clientId,
        }),
      );
    }
    if (parsed.data.projectId !== undefined) {
      Object.assign(
        organization,
        await assignConversationToProject({
          admin,
          prestataireId: context.prestataire.id,
          conversationId: id,
          projectId: parsed.data.projectId,
        }),
      );
    }
    let title: string | undefined;
    if (parsed.data.title !== undefined) {
      const renamed = await renameConversation({
        admin,
        prestataireId: context.prestataire.id,
        conversationId: id,
        title: parsed.data.title,
      });
      title = renamed.title;
    }
    return Response.json(
      { organization, ...(title ? { title } : {}) },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "conversation_scope_invalid" ||
        error.message === "conversation_client_scope_invalid" ||
        error.message === "conversation_project_scope_invalid")
    ) {
      return Response.json(
        { message: "Discussion introuvable." },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    return Response.json(
      { message: SAFE_ERROR },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}

export async function POST(
  request: Request,
  routeContext: ConversationRouteContext,
): Promise<Response> {
  try {
    const { id } = await routeContext.params;
    if (!uuidSchema.safeParse(id).success) {
      return Response.json(
        { message: "Discussion introuvable." },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    const parsed = messageTurnSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        { message: SAFE_ERROR },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    const context = await resolveAssistantConversationRequestContext();
    if (!context) {
      return Response.json(
        { message: "Authentification requise." },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }
    const admin = await createAgentPersistenceClient();
    await persistConversationTurn({
      admin,
      prestataireId: context.prestataire.id,
      conversationId: id,
      userContent: parsed.data.userContent,
      assistantContent: parsed.data.assistantContent,
    });
    return new Response(null, { status: 204, headers: NO_STORE_HEADERS });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "conversation_scope_invalid"
    ) {
      return Response.json(
        { message: "Discussion introuvable." },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    return Response.json(
      { message: SAFE_ERROR },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}

export async function DELETE(
  _request: Request,
  routeContext: ConversationRouteContext,
): Promise<Response> {
  try {
    const { id } = await routeContext.params;
    if (!uuidSchema.safeParse(id).success) {
      return Response.json(
        { message: "Discussion introuvable." },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    const context = await resolveAssistantConversationRequestContext();
    if (!context) {
      return Response.json(
        { message: "Authentification requise." },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }
    const admin = await createAgentPersistenceClient();
    const deleted = await deleteConversation({
      admin,
      prestataireId: context.prestataire.id,
      conversationId: id,
    });
    if (!deleted) {
      return Response.json(
        { message: "Discussion introuvable." },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    return new Response(null, { status: 204, headers: NO_STORE_HEADERS });
  } catch {
    return Response.json(
      { message: SAFE_ERROR },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
