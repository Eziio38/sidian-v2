import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import type { Database } from "@/types/database.generated";

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

function resolveAuthEmail(user: User): string | null {
  if (!user.email) {
    return null;
  }

  return user.email.trim().toLowerCase();
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

export async function ensurePrestataireForUser(
  supabase: SupabaseClient<Database>,
  user: User,
): Promise<PrestataireSummary> {
  if (!user.email_confirmed_at) {
    throw new Error("email_not_confirmed");
  }

  const email = resolveAuthEmail(user);

  if (!email) {
    throw new Error("auth_email_missing");
  }

  const existing = await getPrestataireForUser(supabase, user.id);

  if (existing) {
    return existing;
  }

  const { data, error } = await supabase
    .from("prestataire")
    .insert({
      user_id: user.id,
      email,
      nom: resolveAgencyName(user),
      pricing_version: "early_access_49",
    })
    .select("id, nom, email, user_id")
    .single();

  if (error?.code === "23505") {
    const raced = await getPrestataireForUser(supabase, user.id);

    if (raced) {
      return raced;
    }
  }

  if (error || !data) {
    throw new Error("prestataire_create_failed");
  }

  return data;
}
