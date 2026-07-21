import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.generated";

export type CreanceSummary = Pick<
  Database["public"]["Tables"]["creance"]["Row"],
  | "id"
  | "prestataire_id"
  | "client_payeur_id"
  | "montant"
  | "devise"
  | "origine"
  | "reference_externe"
  | "date_echeance"
  | "etat"
  | "libelle"
  | "archived_at"
  | "created_at"
  | "updated_at"
  | "creation_key"
>;

export type CreanceDraftInput = {
  clientPayeurId: string;
  montantCents: number;
  dateEcheance: string;
  libelle?: string | null;
  referenceExterne?: string | null;
  devise?: string;
  creationKey?: string;
};

export async function listActiveCreances(
  supabase: SupabaseClient<Database>,
): Promise<CreanceSummary[]> {
  const { data, error } = await supabase
    .from("creance")
    .select(
      "id, prestataire_id, client_payeur_id, montant, devise, origine, reference_externe, date_echeance, etat, libelle, archived_at, created_at, updated_at, creation_key",
    )
    .is("archived_at", null)
    .order("date_echeance", { ascending: true });

  if (error) {
    throw new Error("creance_list_failed");
  }

  return data ?? [];
}

export async function createCreanceDraft(
  supabase: SupabaseClient<Database>,
  input: CreanceDraftInput & { creationKey: string },
): Promise<CreanceSummary> {
  const { data, error } = await supabase.rpc("create_current_creance", {
    p_client_payeur_id: input.clientPayeurId,
    p_montant: input.montantCents,
    p_date_echeance: input.dateEcheance,
    p_creation_key: input.creationKey,
    p_libelle: input.libelle ?? undefined,
    p_reference_externe: input.referenceExterne ?? undefined,
    p_devise: input.devise ?? "EUR",
  });

  if (error || !data) {
    if (error?.message?.includes("idempotency_payload_conflict")) {
      throw new Error("idempotency_payload_conflict");
    }
    throw new Error("creance_create_failed");
  }

  return data;
}

export async function updateCreanceDraft(
  supabase: SupabaseClient<Database>,
  id: string,
  input: CreanceDraftInput,
): Promise<CreanceSummary> {
  const { data, error } = await supabase.rpc("update_current_creance_draft", {
    p_id: id,
    p_client_payeur_id: input.clientPayeurId,
    p_montant: input.montantCents,
    p_date_echeance: input.dateEcheance,
    p_libelle: input.libelle ?? undefined,
    p_reference_externe: input.referenceExterne ?? undefined,
    p_devise: input.devise ?? "EUR",
  });

  if (error || !data) {
    throw new Error("creance_update_failed");
  }

  return data;
}

export async function archiveCreance(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<CreanceSummary> {
  const { data, error } = await supabase.rpc("archive_current_creance", {
    p_id: id,
  });

  if (error || !data) {
    throw new Error("creance_archive_failed");
  }

  return data;
}

/**
 * Montant réglé (somme de `paiement`, règlements confirmés uniquement) par
 * créance. RLS `authenticated` scope déjà chaque ligne au prestataire courant
 * — cette fonction ne fait qu'agréger côté application.
 */
export async function listPaidAmountsByCreanceIds(
  supabase: SupabaseClient<Database>,
  creanceIds: string[],
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (creanceIds.length === 0) return totals;

  const { data, error } = await supabase
    .from("paiement")
    .select("creance_id, montant")
    .in("creance_id", creanceIds);

  if (error) {
    throw new Error("paiement_sum_failed");
  }

  for (const row of data ?? []) {
    totals.set(row.creance_id, (totals.get(row.creance_id) ?? 0) + row.montant);
  }
  return totals;
}
