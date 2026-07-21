import { resolveCheckoutReturnStatus } from "@/lib/stripe/checkout/resolve-checkout-status";
import { createAdminClient } from "@/lib/supabase/admin";

import { RecheckButton } from "./recheck-button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gris-50 p-6">
      <div className="w-full max-w-md rounded-2xl border border-gris-200 bg-white p-8 text-center shadow-sm">
        {children}
      </div>
    </main>
  );
}

/**
 * Retour de parcours Checkout. N'affirme jamais une confirmation de paiement
 * à partir des seuls query params Stripe : le statut réel est revérifié
 * côté serveur (tentative_paiement, pilotée par les webhooks PaymentIntent).
 */
export default async function CheckoutReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id: sessionId } = await searchParams;
  const admin = await createAdminClient();
  const status = await resolveCheckoutReturnStatus(admin, sessionId ?? null);

  if (status === "confirmed") {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-gris-900">Paiement confirmé</h1>
        <p className="mt-2 text-sm text-gris-600">
          Merci, votre paiement a bien été reçu et confirmé. Vous pouvez fermer
          cette page.
        </p>
      </Shell>
    );
  }

  if (status === "not_confirmed") {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-gris-900">Paiement non confirmé</h1>
        <p className="mt-2 text-sm text-gris-600">
          Ce paiement n’a pas abouti. Vous pouvez réessayer depuis votre lien de
          paiement, avec le même moyen de paiement ou un autre.
        </p>
      </Shell>
    );
  }

  // "processing" (SEPA en confirmation différée, ou webhook pas encore reçu)
  // et "unknown" (aucune information disponible pour le moment) partagent la
  // même prudence de langage : ne jamais affirmer un statut qu'on ne connaît
  // pas encore avec certitude.
  return (
    <Shell>
      <h1 className="text-lg font-semibold text-gris-900">Paiement en cours</h1>
      <p className="mt-2 text-sm text-gris-600">
        Votre paiement est en cours de traitement. Vous recevrez une
        confirmation dès qu’il sera validé — cela peut prendre quelques
        instants, ou quelques jours ouvrés pour un prélèvement bancaire.
      </p>
      <div className="mt-6">
        <RecheckButton />
      </div>
    </Shell>
  );
}
