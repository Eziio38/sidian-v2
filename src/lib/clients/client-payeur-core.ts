import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.generated";

export type ClientPayeurSummary = Pick<
  Database["public"]["Tables"]["client_payeur"]["Row"],
  | "id"
  | "nom"
  | "email"
  | "prestataire_id"
  | "archived_at"
  | "created_at"
  | "creation_key"
>;

export async function listActiveClientPayeurs(
  supabase: SupabaseClient<Database>,
): Promise<ClientPayeurSummary[]> {
  const { data, error } = await supabase
    .from("client_payeur")
    .select("id, nom, email, prestataire_id, archived_at, created_at, creation_key")
    .is("archived_at", null)
    .order("nom", { ascending: true });

  if (error) {
    throw new Error("client_payeur_list_failed");
  }

  return data ?? [];
}

export async function createClientPayeur(
  supabase: SupabaseClient<Database>,
  input: { nom: string; email: string; creationKey: string },
): Promise<ClientPayeurSummary> {
  const { data, error } = await supabase.rpc("create_current_client_payeur", {
    p_nom: input.nom,
    p_email: input.email,
    p_creation_key: input.creationKey,
  });

  if (error || !data) {
    if (error?.message?.includes("CLIENT_HAS_ACTIVE_CREANCES")) {
      throw new Error("CLIENT_HAS_ACTIVE_CREANCES");
    }
    if (error?.message?.includes("idempotency_payload_conflict")) {
      throw new Error("idempotency_payload_conflict");
    }
    throw new Error("client_payeur_create_failed");
  }

  return {
    id: data.id,
    nom: data.nom,
    email: data.email,
    prestataire_id: data.prestataire_id,
    archived_at: data.archived_at,
    created_at: data.created_at,
    creation_key: data.creation_key,
  };
}

export async function updateClientPayeur(
  supabase: SupabaseClient<Database>,
  input: { id: string; nom: string; email: string },
): Promise<ClientPayeurSummary> {
  const { data, error } = await supabase.rpc("update_current_client_payeur", {
    p_id: input.id,
    p_nom: input.nom,
    p_email: input.email,
  });

  if (error || !data) {
    throw new Error("client_payeur_update_failed");
  }

  return {
    id: data.id,
    nom: data.nom,
    email: data.email,
    prestataire_id: data.prestataire_id,
    archived_at: data.archived_at,
    created_at: data.created_at,
    creation_key: data.creation_key,
  };
}

export async function archiveClientPayeur(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<ClientPayeurSummary> {
  const { data, error } = await supabase.rpc("archive_current_client_payeur", {
    p_id: id,
  });

  if (error || !data) {
    if (error?.message?.includes("CLIENT_HAS_ACTIVE_CREANCES")) {
      throw new Error("CLIENT_HAS_ACTIVE_CREANCES");
    }
    throw new Error("client_payeur_archive_failed");
  }

  return {
    id: data.id,
    nom: data.nom,
    email: data.email,
    prestataire_id: data.prestataire_id,
    archived_at: data.archived_at,
    created_at: data.created_at,
    creation_key: data.creation_key,
  };
}
