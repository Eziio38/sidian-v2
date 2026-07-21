import { AppShell } from "@/components/app/app-shell";
import { StripeConnectPanel } from "@/components/app/stripe-connect-panel";
import {
  beginStripeConnectAction,
  refreshStripeConnectAction,
} from "@/app/app/connexion-stripe/actions";
import { ensurePrestataireForUser } from "@/lib/auth/ensure-prestataire";
import { requireConfirmedUser } from "@/lib/auth/session";
import { getCurrentPrestataireStripeConnectView } from "@/lib/stripe/connect/account-view";
import { getStripeConnectProductContext } from "@/lib/stripe/connect/product-context";
import { classifyStripeFailure } from "@/lib/stripe/shared/errors";
import { logServerEvent } from "@/lib/observability/server-logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function readReturnContext(
  value: string | string[] | undefined,
): "returned" | "expired" | null {
  if (value === "retour") return "returned";
  if (value === "reprise") return "expired";
  return null;
}

export default async function ConnexionStripePage({ searchParams }: PageProps) {
  const user = await requireConfirmedUser();
  const supabaseUser = await createClient();
  await ensurePrestataireForUser(supabaseUser, user);
  const query = await searchParams;
  let activationContext: "ready" | "missing_receivable" | "unavailable" =
    "unavailable";

  try {
    const productContext =
      await getStripeConnectProductContext(supabaseUser);
    activationContext =
      productContext.hasConnectedAccount || productContext.hasReceivable
        ? "ready"
        : "missing_receivable";
  } catch (error) {
    const failure = classifyStripeFailure(error);
    logServerEvent("warn", "stripe.connect.product_context_failed", {
      failureCode: failure.code,
      disposition: failure.disposition,
    });
  }

  let view: Awaited<
    ReturnType<typeof getCurrentPrestataireStripeConnectView>
  > | null = null;

  try {
    const supabaseAdmin = await createAdminClient();
    view = await getCurrentPrestataireStripeConnectView({
      supabaseUser,
      supabaseAdmin,
    });
  } catch (error) {
    const failure = classifyStripeFailure(error);
    logServerEvent("warn", "stripe.connect.product_view_failed", {
      failureCode: failure.code,
      disposition: failure.disposition,
    });
  }

  return (
    <AppShell
      title="Connexion Stripe"
      description="Activez l’encaissement au moment utile, puis suivez ici l’état réel de votre compte Stripe Express."
    >
      <div className="mx-auto max-w-3xl">
        <StripeConnectPanel
          view={view}
          activationContext={activationContext}
          returnContext={readReturnContext(query.source)}
          beginAction={beginStripeConnectAction}
          refreshAction={refreshStripeConnectAction}
        />
      </div>
    </AppShell>
  );
}
