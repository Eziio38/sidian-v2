import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { isStripePaymentsEnabled } from "@/config/env-server";
import { isAuthorizationReconsiderationAvailable } from "@/lib/stripe/authorizations/create-setup-session";
import { resolvePaymentLinkForDisplay } from "@/lib/stripe/checkout/create-payment-session";
import { clientIpFromHeaders } from "@/lib/stripe/checkout/client-ip";
import { createAdminClient } from "@/lib/supabase/admin";

import { PublicPaymentShell } from "../public-payment-shell";
import { authorizationReconsiderationAction } from "./authorization-reconsideration-action";
import { AuthorizationReconsideration } from "./authorization-reconsideration";
import { buildPublicPaymentView } from "./payment-view";
import { payAction } from "./pay-action";
import { PayButton } from "./pay-button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PublicPaymentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  if (!isStripePaymentsEnabled()) {
    notFound();
  }
  const { token } = await params;
  const requestHeaders = await headers();
  const admin = await createAdminClient();

  const result = await resolvePaymentLinkForDisplay({
    supabaseAdmin: admin,
    rawToken: token,
    clientIp: clientIpFromHeaders(requestHeaders),
  });

  if (result.status === "not_found") {
    notFound();
  }

  if (result.status === "rate_limited") {
    return (
      <PublicPaymentShell centred>
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-nuit">
          Merci de patienter
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-gris-500">
          Trop de tentatives. Merci de patienter quelques minutes avant de réessayer.
        </p>
      </PublicPaymentShell>
    );
  }

  const view = buildPublicPaymentView(result);
  const showEuroAmounts = result.devise === "EUR";
  let reconsiderationAvailable = false;
  try {
    reconsiderationAvailable = await isAuthorizationReconsiderationAvailable({
      supabaseAdmin: admin,
      rawPaymentLinkToken: token,
    });
  } catch {
    // Option secondaire fail-closed ; le paiement principal reste utilisable.
  }

  return (
    <PublicPaymentShell>
      <p className="text-sm text-gris-500">Demande de paiement de</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-nuit">
        {view.providerName}
      </h1>
      <p className="mt-4 text-base font-medium text-nuit">{view.label}</p>
      {view.reference ? (
        <p className="mt-1 text-sm text-gris-500">
          Référence&nbsp;: {view.reference}
        </p>
      ) : null}

      <div className="mt-5 flex items-center justify-between gap-4 border-y border-gris-100 py-4">
        <span className="text-sm text-gris-500">Statut</span>
        <span className="rounded-full bg-gris-100 px-3 py-1 text-sm font-medium text-nuit">
          {view.statusLabel}
        </span>
      </div>

      {showEuroAmounts ? (
        <dl className="mt-5 space-y-3 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-gris-500">Montant total</dt>
            <dd className="font-medium tabular-nums text-nuit">{view.total}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-gris-500">Déjà réglé</dt>
            <dd className="font-medium tabular-nums text-nuit">{view.paid}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 border-t border-gris-100 pt-3">
            <dt className="font-medium text-nuit">Reste à régler</dt>
            <dd className="text-xl font-semibold tabular-nums text-nuit">
              {view.remaining}
            </dd>
          </div>
        </dl>
      ) : null}

      {view.dueDate ? (
        <p className="mt-5 text-sm text-gris-500">
          Échéance&nbsp;: <span className="font-medium text-nuit">{view.dueDate}</span>
        </p>
      ) : null}

      {result.payable ? (
        <>
          <section className="mt-6" aria-labelledby="payment-methods-title">
            <h2 id="payment-methods-title" className="text-sm font-medium text-nuit">
              Moyens disponibles maintenant
            </h2>
            <ul className="mt-2 flex flex-wrap gap-2" aria-label="Moyens de paiement disponibles">
              {view.railLabels.map((rail) => (
                <li
                  key={rail}
                  className="rounded-full border border-gris-200 px-3 py-1.5 text-sm text-gris-500"
                >
                  {rail}
                </li>
              ))}
            </ul>
          </section>
          <p className="mt-5 text-sm leading-relaxed text-gris-500">
            Le règlement sera versé directement à {view.providerName}.
          </p>
          <div className="mt-6">
            <PayButton token={token} action={payAction} />
          </div>
        </>
      ) : (
        <div className="mt-6" role="status">
          <h2 className="text-base font-semibold text-nuit">{view.stateTitle}</h2>
          <p className="mt-2 text-sm leading-relaxed text-gris-500">
            {view.stateDescription}
          </p>
        </div>
      )}
      {reconsiderationAvailable ? (
        <AuthorizationReconsideration
          paymentToken={token}
          action={authorizationReconsiderationAction}
        />
      ) : null}
    </PublicPaymentShell>
  );
}
