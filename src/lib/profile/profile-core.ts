import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.generated";
import type { PrestataireProfileInput } from "./schemas";

export type PrestataireProfile = Pick<
  Database["public"]["Tables"]["prestataire"]["Row"],
  | "id"
  | "nom"
  | "email"
  | "profil_agent_defaut"
  | "onboarding_profile_completed_at"
>;

const PROFILE_COLUMNS =
  "id, nom, email, profil_agent_defaut, onboarding_profile_completed_at";

export async function getCurrentPrestataireProfile(
  supabase: SupabaseClient<Database>,
): Promise<PrestataireProfile> {
  const { data, error } = await supabase
    .from("prestataire")
    .select(PROFILE_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error("prestataire_profile_lookup_failed");
  }

  return data;
}

export async function configureCurrentPrestataireProfile(
  supabase: SupabaseClient<Database>,
  input: PrestataireProfileInput,
): Promise<PrestataireProfile> {
  const { data, error } = await supabase.rpc(
    "configure_current_prestataire_profile",
    {
      p_nom: input.nom,
      p_profil_agent: input.profilAgent,
    },
  );

  if (error || !data) {
    throw new Error("prestataire_profile_update_failed");
  }

  return {
    id: data.id,
    nom: data.nom,
    email: data.email,
    profil_agent_defaut: data.profil_agent_defaut,
    onboarding_profile_completed_at: data.onboarding_profile_completed_at,
  };
}
