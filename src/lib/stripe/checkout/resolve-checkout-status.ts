import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.generated";

type Db = Database;

export type CheckoutReturnStatus = "confirmed" | "processing" | "not_confirmed" | "unknown";

type StatusResult = {
  found?: boolean;
  etat?: string;
  montant?: number;
  moyen?: string | null;
  echec_code?: string | null;
};

const PROCESSING_STATES = new Set(["CREEE", "NECESSITE_ACTION_CLIENT", "EN_TRAITEMENT"]);
const NOT_CONFIRMED_STATES = new Set(["ECHOUEE", "ANNULEE"]);

/**
 * Revérifie côté serveur le statut d'un paiement à partir de l'identifiant de
 * Session Checkout renvoyé par Stripe dans l'URL de retour. Ne se fie jamais
 * au seul query param : c'est la ligne tentative_paiement (pilotée par les
 * webhooks PaymentIntent) qui fait foi.
 */
export async function resolveCheckoutReturnStatus(
  supabaseAdmin: SupabaseClient<Db>,
  checkoutSessionId: string | null | undefined,
): Promise<CheckoutReturnStatus> {
  if (!checkoutSessionId) return "unknown";

  const { data, error } = await supabaseAdmin.rpc(
    "resolve_payment_status_by_checkout_session_id",
    { p_checkout_session_id: checkoutSessionId },
  );
  if (error) return "unknown";

  const result = (data ?? { found: false }) as StatusResult;
  if (!result.found || !result.etat) return "unknown";
  if (result.etat === "REUSSIE") return "confirmed";
  if (PROCESSING_STATES.has(result.etat)) return "processing";
  if (NOT_CONFIRMED_STATES.has(result.etat)) return "not_confirmed";
  return "unknown";
}
