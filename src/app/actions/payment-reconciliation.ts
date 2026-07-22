"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireConfirmedUser } from "@/lib/auth/session";
import { logServerEvent } from "@/lib/observability/server-logger";
import { reconcilePaymentReceivableFromStripe } from "@/lib/stripe/reconciliation/payment-reconciliation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type PaymentReconciliationActionResult =
  | {
      ok: true;
      status:
        | "repaired"
        | "up_to_date"
        | "pending"
        | "no_activity"
        | "human_required";
      message: string;
    }
  | { ok: false; status: "retry" | "invalid"; message: string };

const inputSchema = z.object({
  receivableId: z.string().uuid(),
});

function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function successMessage(
  status: Exclude<
    PaymentReconciliationActionResult,
    { ok: false }
  >["status"],
): string {
  switch (status) {
    case "repaired":
      return "Stripe a été relu en direct et la situation locale sûre a été rapprochée.";
    case "up_to_date":
      return "La situation locale correspond déjà aux objets relus chez Stripe.";
    case "pending":
      return "Stripe confirme qu’un paiement attend encore son résultat. Aucun montant n’a été marqué comme réglé.";
    case "no_activity":
      return "Aucune activité Stripe à rapprocher n’a été trouvée pour ce paiement à recevoir.";
    case "human_required":
      return "Une incohérence nécessite un examen humain. Aucun effet financier ambigu n’a été appliqué.";
  }
}

export async function reconcilePaymentReceivableAction(
  _previous: PaymentReconciliationActionResult | undefined,
  formData: FormData,
): Promise<PaymentReconciliationActionResult> {
  const user = await requireConfirmedUser();
  const parsed = inputSchema.safeParse({
    receivableId: formString(formData, "receivableId"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      status: "invalid",
      message: "Paiement à recevoir introuvable.",
    };
  }

  try {
    const [supabaseUser, supabaseAdmin] = await Promise.all([
      createClient(),
      createAdminClient(),
    ]);
    const result = await reconcilePaymentReceivableFromStripe({
      supabaseUser,
      supabaseAdmin,
      userId: user.id,
      receivableId: parsed.data.receivableId,
    });

    if (result.status === "retry") {
      return {
        ok: false,
        status: "retry",
        message:
          "Stripe ne peut pas être vérifié de façon fiable maintenant. Aucune modification financière n’a été appliquée.",
      };
    }

    revalidatePath("/app");
    revalidatePath("/app/paiements-a-recevoir");
    revalidatePath(`/app/paiements-a-recevoir/${parsed.data.receivableId}`);
    revalidatePath("/app/approbations");

    return {
      ok: true,
      status: result.status,
      message: successMessage(result.status),
    };
  } catch (error) {
    const code = error instanceof Error ? error.message : "unknown";
    if (code === "payment_reconciliation_not_found") {
      return {
        ok: false,
        status: "invalid",
        message: "Paiement à recevoir introuvable.",
      };
    }
    logServerEvent("warn", "stripe.payment_reconciliation_failed", {
      failureCode: code,
    });
    return {
      ok: false,
      status: "retry",
      message:
        "La vérification Stripe n’a pas pu aboutir. Aucune modification financière n’a été appliquée.",
    };
  }
}

