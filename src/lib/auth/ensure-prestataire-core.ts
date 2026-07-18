import type { SupabaseClient, User } from "@supabase/supabase-js";

import type { Database } from "../../types/database.generated";

export type PrestataireSummary = Pick<
  Database["public"]["Tables"]["prestataire"]["Row"],
  "id" | "nom" | "email" | "user_id"
>;

function resolveAgencyName(user: User): string {
  const metadata = user.user_metadata ?? {};
  const agencyName =
    typeof metadata.agency_name === "string" ? metadata.agency_name.trim() : "";
  const legacyNom =
    typeof metadata.nom === "string" ? metadata.nom.trim() : "";

  return agencyName || legacyNom || "Mon activité";
}

export async function getPrestataireForUser(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<PrestataireSummary | null> {
  const { data, error } = await supabase
    .from("prestataire")
    .select("id, nom, email, user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("prestataire_lookup_failed");
  }

  return data;
}

/**
 * Onboarding idempotent via RPC SECURITY DEFINER (SID-SEC-001).
 * Ne transmet que le nom — user_id et email sont dérivés côté SQL depuis Auth.
 * Module pur (sans server-only) partagé par l'entrée serveur et les tests.
 */
export async function ensurePrestataireForUser(
  supabase: SupabaseClient<Database>,
  user: User,
): Promise<PrestataireSummary> {
  if (!user.email_confirmed_at) {
    throw new Error("email_not_confirmed");
  }

  if (!user.email) {
    throw new Error("auth_email_missing");
  }

  const { data, error } = await supabase.rpc(
    "ensure_prestataire_for_current_user",
    {
      p_nom: resolveAgencyName(user),
    },
  );

  if (error || !data) {
    throw new Error("prestataire_create_failed");
  }

  return {
    id: data.id,
    nom: data.nom,
    email: data.email,
    user_id: data.user_id,
  };
}
