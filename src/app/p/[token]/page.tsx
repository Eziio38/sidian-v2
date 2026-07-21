import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { isStripePaymentsEnabled } from "@/config/env-server";
import { resolvePaymentLinkForDisplay } from "@/lib/stripe/checkout/create-payment-session";
import { clientIpFromHeaders } from "@/lib/stripe/checkout/client-ip";
import { createAdminClient } from "@/lib/supabase/admin";

import { PayButton } from "./pay-button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

const NOT_PAYABLE_MESSAGES: Record<string, string> = {
  settled: "Ce paiement a déjà été réglé. Merci !",
  not_open: "Ce paiement n’est plus disponible.",
  archived: "Ce paiement n’est plus disponible.",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gris-50 p-6">
      <div className="w-full max-w-md rounded-2xl border border-gris-200 bg-white p-8 shadow-sm">
        {children}
      </div>
    </main>
  );
}

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
  const admin = createAdminClient();

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
      <Shell>
        <h1 className="text-lg font-semibold text-gris-900">Un instant</h1>
        <p className="mt-2 text-sm text-gris-600">
          Trop de tentatives. Merci de patienter quelques minutes avant de réessayer.
        </p>
      </Shell>
    );
  }

  if (!result.payable) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-gris-900">Paiement</h1>
        <p className="mt-2 text-sm text-gris-600">
          {NOT_PAYABLE_MESSAGES[result.reason ?? "not_open"] ??
            NOT_PAYABLE_MESSAGES.not_open}
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="text-sm font-medium uppercase tracking-wide text-gris-500">
        Paiement à régler
      </p>
      <p className="mt-2 text-3xl font-semibold text-gris-900">
        {formatMoney(result.remaining)}
      </p>
      <p className="mt-1 text-sm text-gris-600">
        Paiement sécurisé via Stripe. Vous serez redirigé pour finaliser.
      </p>
      <div className="mt-6">
        <PayButton token={token} />
      </div>
    </Shell>
  );
}
