"use server";

import { revalidatePath } from "next/cache";

import { requireConfirmedUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  cancelPaymentReceivableSafely,
  ensureFollowUpCase,
  updateFollowUpCase,
} from "@/lib/workflows/receivable-workflows";
import {
  followUpUpdateSchema,
  nextActionDateToIso,
  receivableIdSchema,
} from "@/lib/workflows/schemas";

export type WorkflowActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function revalidateReceivable(id: string): void {
  revalidatePath("/app");
  revalidatePath("/app/paiements-a-recevoir");
  revalidatePath(`/app/paiements-a-recevoir/${id}`);
}

function workflowErrorMessage(error: unknown, operation: "case" | "cancel"): string {
  const code = error instanceof Error ? error.message : "";
  switch (code) {
    case "payment_receivable_payment_in_progress":
      return "Un paiement Stripe est encore en cours. Attendez son résultat ou lancez une réconciliation avant d’annuler.";
    case "payment_receivable_stripe_session_not_safely_terminal":
      return "Stripe ne confirme pas encore que ce paiement est définitivement inactif. Réessayez après son rapprochement.";
    case "stripe_connected_scope_mismatch":
    case "payment_receivable_stripe_identity_mismatch":
    case "payment_receivable_stripe_context_unavailable":
    case "payment_receivable_stripe_reconciliation_failed":
      return "La situation de ce paiement n’a pas pu être vérifiée auprès de Stripe. Aucune annulation n’a été appliquée.";
    case "payment_receivable_has_confirmed_payment":
      return "Ce paiement à recevoir possède déjà un règlement confirmé et ne peut pas être annulé.";
    case "payment_receivable_cancellation_not_allowed":
      return "L’état actuel ne permet pas cette annulation.";
    case "follow_up_case_transition_invalid":
      return "Cette transition de suivi n’est pas permise depuis l’état actuel.";
    case "follow_up_case_reason_required":
      return "Indiquez le motif de la pause ou de l’examen humain.";
    case "payment_receivable_not_found":
    case "payment_receivable_archived":
      return "Paiement à recevoir introuvable ou archivé.";
    default:
      return operation === "cancel"
        ? "Impossible d’annuler ce paiement à recevoir pour le moment."
        : "Impossible de mettre à jour le dossier pour le moment.";
  }
}

export async function ensureFollowUpCaseAction(
  _previous: WorkflowActionResult | undefined,
  formData: FormData,
): Promise<WorkflowActionResult> {
  await requireConfirmedUser();
  const id = receivableIdSchema.safeParse(formString(formData, "receivableId"));
  if (!id.success) {
    return { ok: false, message: "Paiement à recevoir introuvable." };
  }
  try {
    const supabase = await createClient();
    await ensureFollowUpCase(supabase, id.data);
    revalidateReceivable(id.data);
    return { ok: true, message: "Dossier de suivi créé." };
  } catch (error) {
    return { ok: false, message: workflowErrorMessage(error, "case") };
  }
}

export async function updateFollowUpCaseAction(
  _previous: WorkflowActionResult | undefined,
  formData: FormData,
): Promise<WorkflowActionResult> {
  await requireConfirmedUser();
  const parsed = followUpUpdateSchema.safeParse({
    receivableId: formString(formData, "receivableId"),
    targetState: formString(formData, "targetState"),
    nextActionDate: formString(formData, "nextActionDate"),
    escalationReason: formString(formData, "escalationReason"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Vérifiez les informations du dossier.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  try {
    const supabase = await createClient();
    await updateFollowUpCase(supabase, {
      receivableId: parsed.data.receivableId,
      targetState: parsed.data.targetState,
      nextActionAt: nextActionDateToIso(parsed.data.nextActionDate),
      escalationReason: parsed.data.escalationReason || null,
    });
    revalidateReceivable(parsed.data.receivableId);
    return { ok: true, message: "Dossier mis à jour." };
  } catch (error) {
    return { ok: false, message: workflowErrorMessage(error, "case") };
  }
}

export async function cancelPaymentReceivableAction(
  _previous: WorkflowActionResult | undefined,
  formData: FormData,
): Promise<WorkflowActionResult> {
  await requireConfirmedUser();
  const id = receivableIdSchema.safeParse(formString(formData, "receivableId"));
  if (!id.success) {
    return { ok: false, message: "Paiement à recevoir introuvable." };
  }
  try {
    const supabase = await createClient();
    await cancelPaymentReceivableSafely(supabase, id.data);
    revalidateReceivable(id.data);
    return { ok: true, message: "Paiement à recevoir annulé." };
  } catch (error) {
    return { ok: false, message: workflowErrorMessage(error, "cancel") };
  }
}
