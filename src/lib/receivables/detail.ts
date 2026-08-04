import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildReceivableTimeline,
  computeReceivableAmounts,
  type ReceivableTimelineEvent,
} from "./detail-core";
import type { Database } from "@/types/database.generated";

export type PaymentReceivableDetail = {
  id: string;
  clientName: string;
  label: string;
  reference: string | null;
  dueDate: string;
  state: Database["public"]["Enums"]["creance_etat"];
  currency: "EUR";
  totalCents: number;
  confirmedCents: number;
  processingCents: number;
  remainingCents: number;
  archived: boolean;
  followUp: {
    state: Database["public"]["Enums"]["dossier_suivi_etat"];
    nextActionAt: string | null;
    escalationReason: string | null;
    closedAt: string | null;
  } | null;
  timeline: ReceivableTimelineEvent[];
};

export async function loadPaymentReceivableDetail(
  supabase: SupabaseClient<Database>,
  prestataireId: string,
  id: string,
): Promise<PaymentReceivableDetail | null> {
  const receivableResult = await supabase
    .from("creance")
    .select(
      "id, client_payeur_id, montant, devise, date_echeance, etat, libelle, reference_externe, archived_at",
    )
    .eq("id", id)
    .eq("prestataire_id", prestataireId)
    .maybeSingle();

  if (receivableResult.error) {
    throw new Error("payment_receivable_detail_lookup_failed");
  }
  if (!receivableResult.data) {
    return null;
  }
  const receivable = receivableResult.data;
  if (receivable.devise !== "EUR") {
    throw new Error("payment_receivable_unsupported_currency");
  }

  const [client, payments, attempts, followUp, audits] = await Promise.all([
    supabase
      .from("client_payeur")
      .select("nom")
      .eq("id", receivable.client_payeur_id)
      .eq("prestataire_id", prestataireId)
      .maybeSingle(),
    supabase
      .from("paiement")
      .select("id, montant, source, created_at")
      .eq("creance_id", receivable.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("tentative_paiement")
      .select("id, montant, moyen, etat, created_at")
      .eq("creance_id", receivable.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("dossier_suivi")
      .select("etat, next_action_at, escalation_reason, clos_at")
      .eq("creance_id", receivable.id)
      .maybeSingle(),
    supabase
      .from("audit_log")
      .select("id, action, actor_type, created_at")
      .eq("prestataire_id", prestataireId)
      .eq("entity_type", "creance")
      .eq("entity_id", receivable.id)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  if (client.error || payments.error || attempts.error || followUp.error || audits.error) {
    throw new Error("payment_receivable_detail_lookup_failed");
  }

  const amounts = computeReceivableAmounts(
    receivable.montant,
    payments.data ?? [],
    attempts.data ?? [],
  );
  const caseRow = followUp.data;

  return {
    id: receivable.id,
    clientName: client.data?.nom ?? "Client",
    label: receivable.libelle?.trim() || "Paiement à recevoir",
    reference: receivable.reference_externe,
    dueDate: receivable.date_echeance,
    state: receivable.etat,
    currency: "EUR",
    totalCents: receivable.montant,
    ...amounts,
    archived: receivable.archived_at !== null,
    followUp: caseRow
      ? {
          state: caseRow.etat,
          nextActionAt: caseRow.next_action_at,
          escalationReason: caseRow.escalation_reason,
          closedAt: caseRow.clos_at,
        }
      : null,
    timeline: buildReceivableTimeline(
      payments.data ?? [],
      attempts.data ?? [],
      audits.data ?? [],
    ),
  };
}
