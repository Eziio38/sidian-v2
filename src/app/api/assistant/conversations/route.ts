import "server-only";

import { z } from "zod";

import {
  createConversation,
  listConversationHistory,
} from "@/lib/assistant-conversations";
import { resolveAssistantConversationRequestContext } from "@/lib/assistant-conversations/request-context";
import { createAgentPersistenceClient } from "@/lib/agent/server/auth/service-role";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createConversationSchema = z
  .object({
    clientId: z.string().uuid().nullable().optional(),
  })
  .strict();

const SAFE_ERROR = "Je n’ai pas pu enregistrer ta demande.";
const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};

export async function GET(): Promise<Response> {
  try {
    const context = await resolveAssistantConversationRequestContext();
    if (!context) {
      return Response.json(
        { message: "Authentification requise." },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }
    const conversations = await listConversationHistory(
      context.supabase,
      context.prestataire.id,
    );
    return Response.json({ conversations }, { headers: NO_STORE_HEADERS });
  } catch {
    return Response.json(
      { message: SAFE_ERROR },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = createConversationSchema.safeParse(await request.json());
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
    const conversation = await createConversation({
      admin,
      prestataireId: context.prestataire.id,
      clientId: parsed.data.clientId,
    });
    return Response.json(
      { conversation },
      { status: 201, headers: NO_STORE_HEADERS },
    );
  } catch {
    return Response.json(
      { message: SAFE_ERROR },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
