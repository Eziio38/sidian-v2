import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ProjectColorId,
  ProjectIconId,
} from "@/components/assistant/project-personalization";
import type { ConversationProject } from "@/components/assistant/types";
import type { Database } from "@/types/database.generated";

type ScopedSupabaseClient = SupabaseClient<Database>;

type ProjectWrite = {
  name: string;
  icon: ProjectIconId;
  color: ProjectColorId;
};

function mapProject(row: {
  id: string;
  name: string;
  icon: string;
  color: string;
}): ConversationProject {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon as ProjectIconId,
    color: row.color as ProjectColorId,
  };
}

export async function listConversationProjects(
  supabase: ScopedSupabaseClient,
  prestataireId: string,
): Promise<ConversationProject[]> {
  const { data, error } = await supabase
    .from("conversation_project")
    .select("id, name, icon, color")
    .eq("prestataire_id", prestataireId)
    .order("created_at", { ascending: false });

  if (error) throw new Error("conversation_projects_load_failed");
  return (data ?? []).map(mapProject);
}

export async function createConversationProject(params: {
  supabase: ScopedSupabaseClient;
  prestataireId: string;
  project: ProjectWrite;
}): Promise<ConversationProject> {
  const { data, error } = await params.supabase
    .from("conversation_project")
    .insert({
      prestataire_id: params.prestataireId,
      name: params.project.name,
      icon: params.project.icon,
      color: params.project.color,
    })
    .select("id, name, icon, color")
    .single();

  if (error || !data) throw new Error("conversation_project_create_failed");
  return mapProject(data);
}

export async function updateConversationProject(params: {
  supabase: ScopedSupabaseClient;
  prestataireId: string;
  projectId: string;
  project: ProjectWrite;
}): Promise<ConversationProject | null> {
  const { data, error } = await params.supabase
    .from("conversation_project")
    .update({
      name: params.project.name,
      icon: params.project.icon,
      color: params.project.color,
    })
    .eq("id", params.projectId)
    .eq("prestataire_id", params.prestataireId)
    .select("id, name, icon, color")
    .maybeSingle();

  if (error) throw new Error("conversation_project_update_failed");
  return data ? mapProject(data) : null;
}

export async function deleteConversationProject(params: {
  supabase: ScopedSupabaseClient;
  prestataireId: string;
  projectId: string;
}): Promise<boolean> {
  const { data, error } = await params.supabase
    .from("conversation_project")
    .delete()
    .eq("id", params.projectId)
    .eq("prestataire_id", params.prestataireId)
    .select("id")
    .maybeSingle();

  if (error) throw new Error("conversation_project_delete_failed");
  return Boolean(data);
}
