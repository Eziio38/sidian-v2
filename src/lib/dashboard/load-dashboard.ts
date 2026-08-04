import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { buildDashboardModel, type DashboardModel } from "./dashboard-model";
import type { Database } from "@/types/database.generated";

function dateInParis(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export async function loadDashboard(
  supabase: SupabaseClient<Database>,
  prestataireId: string,
  now = new Date(),
): Promise<DashboardModel> {
  const [
    receivablesResult,
    paymentsResult,
    attemptsResult,
    approvalsResult,
    casesResult,
    clientsResult,
  ] = await Promise.all([
    supabase
      .from("creance")
      .select(
        "id, client_payeur_id, montant, devise, date_echeance, etat, libelle, archived_at, created_at, updated_at",
      )
      .eq("prestataire_id", prestataireId),
    supabase
      .from("paiement")
      .select("id, creance_id, montant, source, created_at"),
    supabase
      .from("tentative_paiement")
      .select("id, creance_id, montant, etat, created_at"),
    supabase
      .from("approval_request")
      .select(
        "id, creance_id, type, status, created_at, decided_at, expires_at",
      )
      .eq("prestataire_id", prestataireId),
    supabase
      .from("dossier_suivi")
      .select("id, creance_id, etat, escalation_reason, updated_at"),
    supabase
      .from("client_payeur")
      .select("id, nom")
      .eq("prestataire_id", prestataireId),
  ]);

  const error = [
    receivablesResult.error,
    paymentsResult.error,
    attemptsResult.error,
    approvalsResult.error,
    casesResult.error,
    clientsResult.error,
  ].find(Boolean);

  if (error) {
    throw new Error("dashboard_load_failed");
  }

  return buildDashboardModel({
    today: dateInParis(now),
    now: now.toISOString(),
    receivables: receivablesResult.data ?? [],
    payments: paymentsResult.data ?? [],
    attempts: attemptsResult.data ?? [],
    approvals: approvalsResult.data ?? [],
    cases: casesResult.data ?? [],
    clients: clientsResult.data ?? [],
  });
}
