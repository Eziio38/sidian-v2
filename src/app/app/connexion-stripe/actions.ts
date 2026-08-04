"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireConfirmedUser } from "@/lib/auth/session";
import { ensurePrestataireForUser } from "@/lib/auth/ensure-prestataire";
import {
  getCurrentPrestataireStripeConnectView,
  projectStripeConnectAccountView,
} from "@/lib/stripe/connect/account-view";
import { createConnectedAccountLink } from "@/lib/stripe/connect/create-account-link";
import { ensureConnectedAccountForCurrentPrestataire } from "@/lib/stripe/connect/ensure-connected-account";
import { getStripeConnectProductContext } from "@/lib/stripe/connect/product-context";
import {
  classifyStripeFailure,
  StripeDomainError,
} from "@/lib/stripe/shared/errors";
import { logServerEvent } from "@/lib/observability/server-logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type StripeConnectActionState =
  | { status: "success"; message: string }
  | { status: "error"; message: string };

function connectErrorMessage(error: unknown): string {
  const failure = classifyStripeFailure(error);

  if (failure.code === "not_authenticated") {
    return "Votre session a expiré. Reconnectez-vous avant de reprendre la configuration Stripe.";
  }

  if (failure.code === "stripe_connect_receivable_required") {
    return "Créez d’abord un paiement à recevoir. Stripe sera proposé juste avant de rendre son lien partageable.";
  }

  if (
    failure.code === "connect_reconciliation_multiple_accounts" ||
    failure.code === "connect_account_attached_to_other_prestataire" ||
    failure.code === "connect_reconciliation_account_incompatible" ||
    failure.code === "connect_reconciliation_metadata_mismatch" ||
    failure.code === "stripe_account_scope_mismatch"
  ) {
    return "La connexion Stripe nécessite une vérification manuelle. Contactez l’équipe Sidian avant de réessayer.";
  }

  if (failure.disposition === "terminal") {
    return "La configuration Stripe ne peut pas continuer automatiquement. Contactez l’équipe Sidian.";
  }

  return "Stripe est temporairement indisponible. Réessayez dans quelques instants.";
}

function reportConnectActionFailure(event: string, error: unknown): void {
  const failure = classifyStripeFailure(error);
  logServerEvent("warn", event, {
    failureCode: failure.code,
    disposition: failure.disposition,
  });
}

/**
 * Provisionne ou réconcilie le compte via la primitive durable, puis ne crée un
 * Account Link que si le compte live expose réellement des exigences à saisir.
 */
export async function beginStripeConnectAction(
  previousState: StripeConnectActionState | undefined,
  formData: FormData,
): Promise<StripeConnectActionState> {
  void previousState;
  void formData;
  const user = await requireConfirmedUser();

  let destination: string | null = null;

  try {
    const supabaseUser = await createClient();
    await ensurePrestataireForUser(supabaseUser, user);
    const productContext =
      await getStripeConnectProductContext(supabaseUser);
    if (
      !productContext.hasConnectedAccount &&
      !productContext.hasReceivable
    ) {
      throw new StripeDomainError(
        "stripe_connect_receivable_required",
        undefined,
        "terminal",
      );
    }
    const supabaseAdmin = await createAdminClient();
    const ensured = await ensureConnectedAccountForCurrentPrestataire({
      supabaseUser,
      supabaseAdmin,
    });
    const view = projectStripeConnectAccountView(ensured.account);

    if (!view.canOpenOnboarding) {
      revalidatePath("/app/connexion-stripe");
      revalidatePath("/app/paiements-a-recevoir");

      if (view.pendingVerificationCount > 0) {
        return {
          status: "success",
          message:
            "Stripe vérifie déjà vos informations. Aucune nouvelle saisie n’est demandée pour le moment.",
        };
      }

      if (view.requiredRailsActive) {
        return {
          status: "success",
          message: "Votre compte Stripe est déjà prêt pour les encaissements.",
        };
      }

      return {
        status: "success",
        message:
          "Stripe ne demande aucune information supplémentaire. Actualisez l’état plus tard ou contactez l’équipe Sidian si la situation persiste.",
      };
    }

    const accountLink = await createConnectedAccountLink({
      supabaseUser,
      kind: "onboarding",
    });
    destination = accountLink.url;
    revalidatePath("/app/connexion-stripe");
    revalidatePath("/app/paiements-a-recevoir");
  } catch (error) {
    reportConnectActionFailure("stripe.connect.product_start_failed", error);
    return { status: "error", message: connectErrorMessage(error) };
  }

  if (!destination) {
    return {
      status: "error",
      message:
        "Stripe est temporairement indisponible. Réessayez dans quelques instants.",
    };
  }

  redirect(destination);
}

/** Relit Stripe live et resynchronise la projection, sans créer de compte. */
export async function refreshStripeConnectAction(
  previousState: StripeConnectActionState | undefined,
  formData: FormData,
): Promise<StripeConnectActionState> {
  void previousState;
  void formData;
  const user = await requireConfirmedUser();

  try {
    const supabaseUser = await createClient();
    await ensurePrestataireForUser(supabaseUser, user);
    const supabaseAdmin = await createAdminClient();
    const view = await getCurrentPrestataireStripeConnectView({
      supabaseUser,
      supabaseAdmin,
    });
    revalidatePath("/app/connexion-stripe");
    revalidatePath("/app/paiements-a-recevoir");

    return {
      status: "success",
      message: view.configured
        ? "État Stripe actualisé."
        : "Aucun compte Stripe n’est encore configuré.",
    };
  } catch (error) {
    reportConnectActionFailure("stripe.connect.product_refresh_failed", error);
    return { status: "error", message: connectErrorMessage(error) };
  }
}
