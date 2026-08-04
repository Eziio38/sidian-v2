import { headers } from "next/headers";

import { resolveAuthorizationProposalForDisplay } from "@/lib/stripe/authorizations/create-setup-session";
import { clientIpFromHeaders } from "@/lib/stripe/checkout/client-ip";
import { createAdminClient } from "@/lib/supabase/admin";

import { RecheckAuthorizationButton } from "./recheck-authorization-button";

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

export default async function AuthorizationReturnPage({
  searchParams,
}: {
  searchParams: Promise<{
    authorization_token?: string;
    source_session_id?: string;
    session_id?: string;
  }>;
}) {
  const {
    authorization_token: rawToken,
    source_session_id: sourceSessionId,
    session_id: setupSessionId,
  } = await searchParams;
  if (!rawToken || !sourceSessionId || !setupSessionId) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-nuit">
          Autorisation indisponible
        </h1>
        <p className="mt-2 text-sm text-gris-500">
          Aucune autorisation active n’a été déduite de cette adresse.
        </p>
      </Shell>
    );
  }

  let result: Awaited<
    ReturnType<typeof resolveAuthorizationProposalForDisplay>
  > | null = null;
  try {
    const [admin, requestHeaders] = await Promise.all([
      createAdminClient(),
      headers(),
    ]);
    result = await resolveAuthorizationProposalForDisplay({
      supabaseAdmin: admin,
      rawToken,
      sourceCheckoutSessionId: sourceSessionId,
      setupCheckoutSessionId: setupSessionId,
      clientIp: clientIpFromHeaders(requestHeaders),
    });

  } catch {
    // Échec fermé : ne jamais inférer ACTIVE depuis le retour navigateur.
  }

  if (result?.status === "display" && result.state === "ACTIVE") {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-nuit">
          Autorisation enregistrée
        </h1>
        <p className="mt-2 text-sm text-gris-500">
          Le moyen choisi est maintenant enregistré chez Stripe pour vos futurs
          paiements éligibles auprès de {result.prestataireNom}. Aucun nouveau
          paiement n’a été déclenché par cette configuration.
        </p>
      </Shell>
    );
  }

  if (
    result?.status === "display" &&
    ["REFUSEE", "EXPIREE", "REVOQUEE"].includes(result.state)
  ) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-nuit">
          Autorisation non active
        </h1>
        <p className="mt-2 text-sm text-gris-500">
          Aucun moyen ne sera utilisé automatiquement depuis cette autorisation.
        </p>
      </Shell>
    );
  }

  if (result?.status === "display") {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-nuit">
          Configuration en cours
        </h1>
        <p className="mt-2 text-sm text-gris-500">
          Stripe a terminé l’écran sécurisé. Sidian attend encore la confirmation
          fiable du moyen ou du mandat ; aucune autorisation n’est considérée
          active avant ce signal.
        </p>
        <RecheckAuthorizationButton />
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-lg font-semibold text-nuit">
        Vérification indisponible
      </h1>
      <p className="mt-2 text-sm text-gris-500">
        Nous ne pouvons pas confirmer cette autorisation pour le moment. Aucun
        nouveau paiement n’a été déclenché.
      </p>
      <RecheckAuthorizationButton />
    </Shell>
  );
}
