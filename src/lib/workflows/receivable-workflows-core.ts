import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.generated";

type FollowUpState = Database["public"]["Enums"]["dossier_suivi_etat"];

export type FollowUpCase = {
  id: string;
  state: FollowUpState;
  nextActionAt: string | null;
  escalationReason: string | null;
  closedAt: string | null;
};

const KNOWN_DOMAIN_ERRORS = new Set([
  "payment_receivable_id_required",
  "payment_receivable_not_found",
  "payment_receivable_archived",
  "payment_receivable_not_open",
  "payment_receivable_cancellation_not_allowed",
  "payment_receivable_payment_in_progress",
  "payment_receivable_has_confirmed_payment",
  "follow_up_case_target_state_required",
  "follow_up_case_reason_too_long",
  "follow_up_case_transition_invalid",
  "follow_up_case_closed_has_next_action",
  "follow_up_case_reason_required",
]);

function throwSafeDomainError(message: string | undefined): never {
  if (message && KNOWN_DOMAIN_ERRORS.has(message)) {
    throw new Error(message);
  }
  throw new Error("receivable_workflow_failed");
}

function toFollowUpCase(
  row: Database["public"]["Tables"]["dossier_suivi"]["Row"],
): FollowUpCase {
  return {
    id: row.id,
    state: row.etat,
    nextActionAt: row.next_action_at,
    escalationReason: row.escalation_reason,
    closedAt: row.clos_at,
  };
}

export async function ensureFollowUpCase(
  supabase: SupabaseClient<Database>,
  receivableId: string,
): Promise<FollowUpCase> {
  const { data, error } = await supabase.rpc("ensure_current_dossier_suivi", {
    p_creance_id: receivableId,
  });
  if (error || !data) {
    throwSafeDomainError(error?.message);
  }
  return toFollowUpCase(data);
}

export async function updateFollowUpCase(
  supabase: SupabaseClient<Database>,
  input: {
    receivableId: string;
    targetState: FollowUpState;
    nextActionAt: string | null;
    escalationReason: string | null;
  },
): Promise<FollowUpCase> {
  // Postgres accepte bien NULL pour ces paramètres ; le générateur Supabase
  // ne représente pas encore leur nullabilité dans Args.
  const nullableNextAction = input.nextActionAt as unknown as string;
  const nullableReason = input.escalationReason as unknown as string;
  const { data, error } = await supabase.rpc("update_current_dossier_suivi", {
    p_creance_id: input.receivableId,
    p_target_state: input.targetState,
    p_next_action_at: nullableNextAction,
    p_escalation_reason: nullableReason,
  });
  if (error || !data) {
    throwSafeDomainError(error?.message);
  }
  return toFollowUpCase(data);
}

export async function cancelPaymentReceivable(
  supabase: SupabaseClient<Database>,
  receivableId: string,
): Promise<void> {
  const { error } = await supabase.rpc("cancel_current_payment_receivable", {
    p_creance_id: receivableId,
  });
  if (error) {
    throwSafeDomainError(error.message);
  }
}
