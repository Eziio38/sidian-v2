import { headers } from "next/headers";

import { resolveAuthorizationProposalForDisplay } from "@/lib/stripe/authorizations/create-setup-session";
import { clientIpFromHeaders } from "@/lib/stripe/checkout/client-ip";
import { resolveCheckoutReturnStatus } from "@/lib/stripe/checkout/resolve-checkout-status";
import { checkoutReturnPresentation } from "@/lib/stripe/checkout/return-presentation";
import { createAdminClient } from "@/lib/supabase/admin";

import { PublicPaymentShell } from "../public-payment-shell";
import { authorizationDecisionAction } from "./authorization-actions";
import { AuthorizationProposal } from "./authorization-proposal";
import { RecheckButton } from "./recheck-button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retour de parcours Checkout. N'affirme jamais une confirmation de paiement
 * à partir des seuls query params Stripe : le statut réel est revérifié
 * côté serveur (tentative_paiement, pilotée par les webhooks PaymentIntent).
 *
 * Le token d'autorisation voyage éventuellement dans l'URL de succès Stripe :
 * le layout /p impose referrer=no-referrer ; le token brut n'est jamais loggé.
 */
export default async function CheckoutReturnPage({
  searchParams,
}: {
  searchParams: Promise<{
    session_id?: string;
    authorization_token?: string;
  }>;
}) {
  const {
    session_id: sessionId,
    authorization_token: authorizationToken,
  } = await searchParams;
  const admin = await createAdminClient();
  const status = await resolveCheckoutReturnStatus(admin, sessionId ?? null);
  let authorizationProposalData: {
    prestataireNom: string;
    initialPaymentProcessing: boolean;
  } | null = null;
  if (
    sessionId &&
    authorizationToken &&
    (status === "confirmed" || status === "processing")
  ) {
    try {
      const requestHeaders = await headers();
      const resolved = await resolveAuthorizationProposalForDisplay({
        supabaseAdmin: admin,
        rawToken: authorizationToken,
        sourceCheckoutSessionId: sessionId,
        clientIp: clientIpFromHeaders(requestHeaders),
      });
      if (resolved.status === "display" && resolved.state === "PROPOSEE") {
        authorizationProposalData = {
          prestataireNom: resolved.prestataireNom,
          initialPaymentProcessing: resolved.initialPaymentProcessing,
        };
      }
    } catch {
      // Le statut du paiement reste affichable si la proposition distincte est
      // momentanément indisponible. Aucun détail technique n'est exposé.
    }
  }
  const authorizationProposal = authorizationProposalData ? (
    <AuthorizationProposal
      rawToken={authorizationToken!}
      sourceCheckoutSessionId={sessionId!}
      prestataireNom={authorizationProposalData.prestataireNom}
      initialPaymentProcessing={
        authorizationProposalData.initialPaymentProcessing
      }
      action={authorizationDecisionAction}
    />
  ) : null;

  if (status === "confirmed") {
    return (
      <PublicPaymentShell centred>
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-nuit">
          Paiement confirmé
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-gris-500">
          Merci, votre paiement a bien été reçu et confirmé. Vous pouvez fermer
          cette page.
        </p>
        {authorizationProposal}
      </PublicPaymentShell>
    );
  }

  if (status === "not_confirmed") {
    return (
      <PublicPaymentShell centred>
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-nuit">
          Paiement non confirmé
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-gris-500">
          Ce paiement n’a pas abouti. Vous pouvez réessayer depuis votre lien de
          paiement, avec le même moyen de paiement ou un autre.
        </p>
      </PublicPaymentShell>
    );
  }

  const presentation = checkoutReturnPresentation(status);
  return (
    <PublicPaymentShell centred>
      <h1 className="text-xl font-semibold tracking-[-0.02em] text-nuit">
        {presentation.title}
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-gris-500">
        {presentation.message}
      </p>
      {presentation.canRecheck ? (
        <div className="mt-6">
          <RecheckButton />
        </div>
      ) : null}
      {authorizationProposal}
    </PublicPaymentShell>
  );
}
