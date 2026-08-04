import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AssistantMessage,
  ConversationHistoryItem,
} from "@/components/assistant/types";
import type { Database } from "@/types/database.generated";

export type { ConversationHistoryItem };

type UserSupabaseClient = SupabaseClient<Database>;
type AdminSupabaseClient = SupabaseClient<Database>;

const MAX_HISTORY_ITEMS = 48;
const MAX_HISTORY_MESSAGES = 600;
const MAX_MESSAGE_LENGTH = 8_000;

function normalizeMessage(content: string): string {
  return content.trim().slice(0, MAX_MESSAGE_LENGTH);
}

function compactLabel(content: string, fallback: string): string {
  const oneLine = content.replace(/\s+/g, " ").trim();
  if (!oneLine) return fallback;
  return oneLine.length > 42 ? `${oneLine.slice(0, 39).trimEnd()}…` : oneLine;
}

/**
 * Lecture user-scopée : le client Supabase conserve la RLS comme seconde
 * barrière. Aucun identifiant de prestataire ne vient du navigateur.
 */
export async function listConversationHistory(
  supabase: UserSupabaseClient,
  prestataireId: string,
): Promise<ConversationHistoryItem[]> {
  const { data: conversations, error: conversationError } = await supabase
    .from("conversation")
    .select("id, client_payeur_id, project_id, title, created_at, updated_at")
    .eq("prestataire_id", prestataireId)
    .order("updated_at", { ascending: false })
    .limit(MAX_HISTORY_ITEMS);

  if (conversationError) {
    throw new Error("conversation_history_load_failed");
  }
  if (!conversations?.length) return [];

  const conversationIds = conversations.map((conversation) => conversation.id);
  const clientIds = Array.from(
    new Set(
      conversations
        .map((conversation) => conversation.client_payeur_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const projectIds = Array.from(
    new Set(
      conversations
        .map((conversation) => conversation.project_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const [messagesResult, clientsResult, projectsResult] = await Promise.all([
    supabase
      .from("message")
      .select("conversation_id, contenu, emetteur, created_at")
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: false })
      .limit(MAX_HISTORY_MESSAGES),
    clientIds.length > 0
      ? supabase
          .from("client_payeur")
          .select("id, nom")
          .eq("prestataire_id", prestataireId)
          .in("id", clientIds)
      : Promise.resolve({ data: [], error: null }),
    projectIds.length > 0
      ? supabase
          .from("conversation_project")
          .select("id, name")
          .eq("prestataire_id", prestataireId)
          .in("id", projectIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (messagesResult.error || clientsResult.error || projectsResult.error) {
    throw new Error("conversation_history_details_load_failed");
  }

  const clientNames = new Map(
    (clientsResult.data ?? []).map((client) => [client.id, client.nom]),
  );
  const projectNames = new Map(
    (projectsResult.data ?? []).map((project) => [project.id, project.name]),
  );
  const latestByConversation = new Map<
    string,
    { contenu: string; emetteur: string; created_at: string }
  >();
  const latestUserByConversation = new Map<string, string>();

  for (const message of messagesResult.data ?? []) {
    if (!latestByConversation.has(message.conversation_id)) {
      latestByConversation.set(message.conversation_id, {
        contenu: message.contenu,
        emetteur: message.emetteur,
        created_at: message.created_at,
      });
    }
    if (
      message.emetteur === "prestataire" &&
      !latestUserByConversation.has(message.conversation_id)
    ) {
      latestUserByConversation.set(message.conversation_id, message.contenu);
    }
  }

  // Tri = dernier message envoyé/reçu — pas un simple « open » / attach.
  return conversations
    .filter((conversation) => latestByConversation.has(conversation.id))
    .map((conversation) => {
      const clientName = conversation.client_payeur_id
        ? clientNames.get(conversation.client_payeur_id) ?? null
        : null;
      const latest = latestByConversation.get(conversation.id);
      const latestUser = latestUserByConversation.get(conversation.id);
      return {
        id: conversation.id,
        clientId: conversation.client_payeur_id,
        clientName,
        projectId: conversation.project_id,
        projectName: conversation.project_id
          ? projectNames.get(conversation.project_id) ?? null
          : null,
        title:
          conversation.title ??
          compactLabel(
            latestUser ?? latest?.contenu ?? "",
            clientName ? `Suivi ${clientName}` : "Nouvelle discussion",
          ),
        titleCustom: Boolean(conversation.title),
        preview: latest ? compactLabel(latest.contenu, "") || null : null,
        updatedAt: latest?.created_at ?? conversation.updated_at,
      };
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function loadConversationMessages(
  supabase: UserSupabaseClient,
  prestataireId: string,
  conversationId: string,
): Promise<AssistantMessage[] | null> {
  const { data: conversation, error: conversationError } = await supabase
    .from("conversation")
    .select("id")
    .eq("id", conversationId)
    .eq("prestataire_id", prestataireId)
    .maybeSingle();

  if (conversationError) {
    throw new Error("conversation_load_failed");
  }
  if (!conversation) return null;

  const { data: messages, error: messageError } = await supabase
    .from("message")
    .select("id, contenu, emetteur, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(300);

  if (messageError) {
    throw new Error("conversation_messages_load_failed");
  }

  return (messages ?? []).map((message) => ({
    id: message.id,
    role: message.emetteur === "prestataire" ? "user" : "assistant",
    content: message.contenu,
    createdAt: message.created_at,
    status: "sent",
  }));
}

/**
 * Toutes les écritures passent par service_role après résolution serveur du
 * prestataire. Le navigateur ne fournit jamais emetteur/actor_type.
 */
export async function createConversation(params: {
  admin: AdminSupabaseClient;
  prestataireId: string;
  clientId?: string | null;
}): Promise<ConversationHistoryItem> {
  const clientId = params.clientId?.trim() || null;
  let clientName: string | null = null;

  if (clientId) {
    const { data: client, error: clientError } = await params.admin
      .from("client_payeur")
      .select("id, nom")
      .eq("id", clientId)
      .eq("prestataire_id", params.prestataireId)
      .is("archived_at", null)
      .maybeSingle();
    if (clientError || !client) {
      throw new Error("conversation_client_scope_invalid");
    }
    clientName = client.nom;
  }

  const { data, error } = await params.admin
    .from("conversation")
    .insert({
      prestataire_id: params.prestataireId,
      client_payeur_id: clientId,
    })
    .select("id, client_payeur_id, created_at, updated_at")
    .single();

  if (error || !data) {
    throw new Error("conversation_create_failed");
  }

  return {
    id: data.id,
    clientId: data.client_payeur_id,
    clientName,
    title: clientName ? `Suivi ${clientName}` : "Nouvelle discussion",
    preview: null,
    updatedAt: data.updated_at,
  };
}

export async function assertConversationScope(params: {
  admin: AdminSupabaseClient;
  prestataireId: string;
  conversationId: string;
}): Promise<boolean> {
  const { data, error } = await params.admin
    .from("conversation")
    .select("id")
    .eq("id", params.conversationId)
    .eq("prestataire_id", params.prestataireId)
    .maybeSingle();
  return !error && Boolean(data);
}

export async function persistConversationTurn(params: {
  admin: AdminSupabaseClient;
  prestataireId: string;
  conversationId: string;
  userContent: string;
  assistantContent: string;
}): Promise<void> {
  const userContent = normalizeMessage(params.userContent);
  const assistantContent = normalizeMessage(params.assistantContent);
  if (!userContent || !assistantContent) {
    throw new Error("conversation_turn_empty");
  }

  const inScope = await assertConversationScope(params);
  if (!inScope) {
    throw new Error("conversation_scope_invalid");
  }

  const { error } = await params.admin.from("message").insert([
    {
      conversation_id: params.conversationId,
      emetteur: "prestataire",
      actor_type: "human",
      canal: "interface",
      contenu: userContent,
    },
    {
      conversation_id: params.conversationId,
      emetteur: "agent",
      actor_type: "sidian_agent",
      canal: "interface",
      contenu: assistantContent,
    },
  ]);
  if (error) {
    throw new Error("conversation_turn_persist_failed");
  }

  // Le transcript est la donnée probatoire. Le timestamp de tri est un confort
  // d’interface : une panne de ce touch ne doit pas provoquer un retry qui
  // dupliquerait un tour déjà persisté.
  await params.admin
    .from("conversation")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", params.conversationId)
    .eq("prestataire_id", params.prestataireId);
}

export async function deleteConversation(params: {
  admin: AdminSupabaseClient;
  prestataireId: string;
  conversationId: string;
}): Promise<boolean> {
  const inScope = await assertConversationScope(params);
  if (!inScope) return false;

  // Les messages partent en cascade (FK on delete cascade).
  // Ne pas exiger de représentation : PostgREST peut renvoyer un body vide
  // même quand la suppression a réussi.
  const { error } = await params.admin
    .from("conversation")
    .delete()
    .eq("id", params.conversationId)
    .eq("prestataire_id", params.prestataireId);

  if (error) {
    throw new Error("conversation_delete_failed");
  }
  return true;
}

export async function renameConversation(params: {
  admin: AdminSupabaseClient;
  prestataireId: string;
  conversationId: string;
  title: string;
}): Promise<{ title: string }> {
  const title = params.title.trim();
  if (!title || title.length > 80) {
    throw new Error("conversation_title_invalid");
  }

  const { data, error } = await params.admin
    .from("conversation")
    .update({ title })
    .eq("id", params.conversationId)
    .eq("prestataire_id", params.prestataireId)
    .select("title")
    .maybeSingle();

  if (error) {
    throw new Error("conversation_rename_failed");
  }
  if (!data?.title) {
    throw new Error("conversation_scope_invalid");
  }

  return { title: data.title };
}

export async function attachConversationToClient(params: {
  admin: AdminSupabaseClient;
  prestataireId: string;
  conversationId: string;
  clientId: string | null;
}): Promise<{ clientId: string | null; clientName: string | null }> {
  const inScope = await assertConversationScope(params);
  if (!inScope) {
    throw new Error("conversation_scope_invalid");
  }

  const clientId = params.clientId?.trim() || null;
  let clientName: string | null = null;

  if (clientId) {
    const { data: client, error: clientError } = await params.admin
      .from("client_payeur")
      .select("id, nom")
      .eq("id", clientId)
      .eq("prestataire_id", params.prestataireId)
      .maybeSingle();
    if (clientError || !client) {
      throw new Error("conversation_client_scope_invalid");
    }
    clientName = client.nom;
  }

  const { data, error } = await params.admin
    .from("conversation")
    .update({
      client_payeur_id: clientId,
    })
    .eq("id", params.conversationId)
    .eq("prestataire_id", params.prestataireId)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    throw new Error("conversation_attach_failed");
  }

  return { clientId, clientName };
}

export async function assignConversationToProject(params: {
  admin: AdminSupabaseClient;
  prestataireId: string;
  conversationId: string;
  projectId: string | null;
}): Promise<{ projectId: string | null; projectName: string | null }> {
  const inScope = await assertConversationScope(params);
  if (!inScope) {
    throw new Error("conversation_scope_invalid");
  }

  const projectId = params.projectId?.trim() || null;
  let projectName: string | null = null;

  if (projectId) {
    const { data: project, error: projectError } = await params.admin
      .from("conversation_project")
      .select("id, name")
      .eq("id", projectId)
      .eq("prestataire_id", params.prestataireId)
      .maybeSingle();
    if (projectError || !project) {
      throw new Error("conversation_project_scope_invalid");
    }
    projectName = project.name;
  }

  const { data, error } = await params.admin
    .from("conversation")
    .update({ project_id: projectId })
    .eq("id", params.conversationId)
    .eq("prestataire_id", params.prestataireId)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    throw new Error("conversation_project_attach_failed");
  }

  return { projectId, projectName };
}
