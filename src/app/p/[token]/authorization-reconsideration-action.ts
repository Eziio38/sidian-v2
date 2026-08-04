"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getPublicEnv } from "@/config/env-public";
import { getSidianEnvironment, isStripePaymentsEnabled } from "@/config/env-server";
import { prepareAuthorizationReconsideration } from "@/lib/stripe/authorizations/create-setup-session";
import { parsePaymentLinkTokenForm } from "@/lib/stripe/authorizations/public-input";
import { clientIpFromHeaders } from "@/lib/stripe/checkout/client-ip";
import { createAdminClient } from "@/lib/supabase/admin";

export type ReconsiderationActionState =
  | null
  | { status: "not_available" | "rate_limited" | "error" };

export async function authorizationReconsiderationAction(
  _previous: ReconsiderationActionState,
  formData: FormData,
): Promise<ReconsiderationActionState> {
  if (!isStripePaymentsEnabled()) return { status: "not_available" };
  const parsed = parsePaymentLinkTokenForm(formData);
  if (!parsed.success) return { status: "not_available" };
  const rawPaymentLinkToken = parsed.data;
  try {
    const [admin, requestHeaders] = await Promise.all([
      createAdminClient(),
      headers(),
    ]);
    const result = await prepareAuthorizationReconsideration({
      supabaseAdmin: admin,
      rawPaymentLinkToken,
      clientIp: clientIpFromHeaders(requestHeaders),
      appUrl: getPublicEnv().NEXT_PUBLIC_APP_URL,
      sidianEnvironment: getSidianEnvironment(),
    });
    if (result.status === "ready") redirect(result.url);
    return { status: result.status };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "digest" in error &&
      String((error as { digest?: unknown }).digest ?? "").startsWith(
        "NEXT_REDIRECT",
      )
    ) {
      throw error;
    }
    return { status: "error" };
  }
}
