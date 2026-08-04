import "server-only";

import { z } from "zod";

import {
  deleteConversationProject,
  updateConversationProject,
} from "@/lib/assistant-projects";
import { resolveAssistantConversationRequestContext } from "@/lib/assistant-conversations/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProjectRouteContext = {
  params: Promise<{ id: string }>;
};

const uuidSchema = z.string().uuid();
const projectSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    icon: z.enum([
      "folder",
      "briefcase",
      "user",
      "building",
      "document",
      "invoice",
      "star",
      "shield",
    ]),
    color: z.enum(["sidian", "violet", "green", "amber", "orange", "coral"]),
  })
  .strict();
const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};
const SAFE_ERROR = "Je n’ai pas pu enregistrer ta demande.";

export async function PATCH(
  request: Request,
  routeContext: ProjectRouteContext,
): Promise<Response> {
  try {
    const { id } = await routeContext.params;
    if (!uuidSchema.safeParse(id).success) {
      return Response.json(
        { message: "Projet introuvable." },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    const parsed = projectSchema.safeParse(await request.json());
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
    const project = await updateConversationProject({
      supabase: context.supabase,
      prestataireId: context.prestataire.id,
      projectId: id,
      project: parsed.data,
    });
    if (!project) {
      return Response.json(
        { message: "Projet introuvable." },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    return Response.json({ project }, { headers: NO_STORE_HEADERS });
  } catch {
    return Response.json(
      { message: SAFE_ERROR },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}

export async function DELETE(
  _request: Request,
  routeContext: ProjectRouteContext,
): Promise<Response> {
  try {
    const { id } = await routeContext.params;
    if (!uuidSchema.safeParse(id).success) {
      return Response.json(
        { message: "Projet introuvable." },
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
    const deleted = await deleteConversationProject({
      supabase: context.supabase,
      prestataireId: context.prestataire.id,
      projectId: id,
    });
    if (!deleted) {
      return Response.json(
        { message: "Projet introuvable." },
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
