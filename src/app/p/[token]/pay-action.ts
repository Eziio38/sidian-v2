"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getPublicEnv } from "@/config/env-public";
import { getSidianEnvironment, isStripePaymentsEnabled } from "@/config/env-server";
import { createPaymentCheckoutSession } from "@/lib/stripe/checkout/create-payment-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIpFromHeaders } from "@/lib/stripe/checkout/client-ip";

export type PayActionState = {
  status: "not_payable" | "rate_limited" | "retry" | "not_found" | "error";
  reason?: string;
} | null;

/**
 * Action « Payer » : crée une Session Checkout fraîche côté serveur et redirige
 * vers Stripe. Le navigateur ne décide jamais de l'état financier ; toute la
 * validation (token, créance, compte payable live, quotas) est serveur.
 */
export async function payAction(
  _prev: PayActionState,
  formData: FormData,
): Promise<PayActionState> {
  if (!isStripePaymentsEnabled()) {
    return { status: "not_found" };
  }
  const token = String(formData.get("token") ?? "");
  const requestHeaders = await headers();
  const admin = await createAdminClient();

  let result;
  try {
    result = await createPaymentCheckoutSession({
      supabaseAdmin: admin,
      rawToken: token,
      clientIp: clientIpFromHeaders(requestHeaders),
      appUrl: getPublicEnv().NEXT_PUBLIC_APP_URL,
      sidianEnvironment: getSidianEnvironment(),
    });
  } catch {
    // Jamais de détail Stripe/interne exposé au client public.
    return { status: "error" };
  }

  if (result.status === "ready") {
    redirect(result.url);
  }
  return {
    status: result.status,
    reason: "reason" in result ? result.reason : undefined,
  };
}
