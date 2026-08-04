import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/types/database.generated";

export type ApprovalRequestSummary = Pick<
  Database["public"]["Tables"]["approval_request"]["Row"],
  "id" | "type" | "status" | "payload" | "created_at" | "expires_at"
>;

export type ApprovalPresentation = {
  title: string;
  description: string;
  amount: string | null;
};

function objectPayload(payload: Json): Record<string, Json | undefined> {
  return payload !== null && !Array.isArray(payload) && typeof payload === "object"
    ? payload
    : {};
}

function positiveInteger(value: Json | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function formatEur(cents: number | null): string | null {
  if (cents === null) {
    return null;
  }
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

export function presentApprovalRequest(
  request: ApprovalRequestSummary,
): ApprovalPresentation {
  const payload = objectPayload(request.payload);
  const reason = typeof payload.reason === "string" ? payload.reason : "";

  if (reason === "charge_dispute_created") {
    return {
      title: "Contestation bancaire à examiner",
      description:
        "Stripe a signalé une contestation. Les automatismes doivent rester en pause pendant votre examen.",
      amount: null,
    };
  }

  if (reason === "payment_succeeded_tentative_unresolved") {
    return {
      title: "Paiement Stripe à rapprocher",
      description:
        "Stripe confirme un paiement, mais Sidian ne peut pas encore le rattacher sûrement. Une vérification humaine est nécessaire ; valider ici ne modifie aucun solde.",
      amount: formatEur(positiveInteger(payload.amount_received)),
    };
  }

  if (
    reason === "payment_on_non_open_receivable" ||
    request.type === "depassement_seuil"
  ) {
    return {
      title: "Situation de paiement inhabituelle",
      description:
        "Un montant confirmé dépasse le scénario attendu ou concerne un paiement à recevoir qui n’était plus ouvert. Examinez la situation avant toute suite.",
      amount: formatEur(positiveInteger(payload.amount_paid)),
    };
  }

  if (request.type === "rule_change") {
    return {
      title: "Modification de règle proposée",
      description:
        "Une règle encadrée attend votre confirmation explicite. Son application éventuelle reste assurée par la commande métier correspondante.",
      amount: null,
    };
  }

  if (request.type === "formal_action") {
    return {
      title: "Action formelle à examiner",
      description:
        "Cette action ne peut jamais être décidée par l’agent seul. Vérifiez le contexte avant de donner ou refuser votre accord.",
      amount: null,
    };
  }

  return {
    title: "Décision humaine requise",
    description:
      "Une situation sort du cadre automatique. Votre décision sera auditée sans déclencher de modification financière depuis le navigateur.",
    amount: null,
  };
}

export async function listApprovalRequests(
  supabase: SupabaseClient<Database>,
): Promise<ApprovalRequestSummary[]> {
  const { data, error } = await supabase
    .from("approval_request")
    .select("id, type, status, payload, created_at, expires_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new Error("approval_request_lookup_failed");
  }

  return data ?? [];
}

export async function decideApprovalRequest(
  supabase: SupabaseClient<Database>,
  id: string,
  decision: "approved" | "rejected",
): Promise<"approved" | "rejected" | "expired"> {
  const { data, error } = await supabase.rpc(
    "decide_current_approval_request",
    {
      p_approval_request_id: id,
      p_decision: decision,
    },
  );

  if (error || !data) {
    throw new Error("approval_request_decision_failed");
  }

  if (data.status === "approved" || data.status === "rejected" || data.status === "expired") {
    return data.status;
  }

  throw new Error("approval_request_decision_failed");
}
