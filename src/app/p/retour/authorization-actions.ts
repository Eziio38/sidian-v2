"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getPublicEnv } from "@/config/env-public";
import { getSidianEnvironment, isStripePaymentsEnabled } from "@/config/env-server";
import {
  createAuthorizationSetupSession,
  declineAuthorizationProposal,
} from "@/lib/stripe/authorizations/create-setup-session";
import { parseAuthorizationDecisionForm } from "@/lib/stripe/authorizations/public-input";
import { clientIpFromHeaders } from "@/lib/stripe/checkout/client-ip";
import { createAdminClient } from "@/lib/supabase/admin";

export type AuthorizationDecisionState =
  | null
  | {
      status:
        | "declined"
        | "consent_required"
        | "not_available"
        | "expired"
        | "rate_limited"
        | "retry"
        | "error";
    };

export async function authorizationDecisionAction(
  _previous: AuthorizationDecisionState,
  formData: FormData,
): Promise<AuthorizationDecisionState> {
  if (!isStripePaymentsEnabled()) return { status: "not_available" };

  const parsed = parseAuthorizationDecisionForm(formData);
  if (!parsed.success) return { status: "not_available" };
  const { rawToken, sourceCheckoutSessionId, decision } = parsed.data;

  try {
    const [admin, requestHeaders] = await Promise.all([
      createAdminClient(),
      headers(),
    ]);
    const clientIp = clientIpFromHeaders(requestHeaders);
    if (decision === "decline") {
      const result = await declineAuthorizationProposal({
        supabaseAdmin: admin,
        rawToken,
        sourceCheckoutSessionId,
        clientIp,
      });
      return { status: result };
    }
    if (formData.get("consent") !== "accepted") {
      return { status: "consent_required" };
    }

    const result = await createAuthorizationSetupSession({
      supabaseAdmin: admin,
      rawToken,
      sourceCheckoutSessionId,
      clientIp,
      consentAccepted: true,
      appUrl: getPublicEnv().NEXT_PUBLIC_APP_URL,
      sidianEnvironment: getSidianEnvironment(),
    });
    if (result.status === "ready") redirect(result.url);
    if (result.status === "completed") redirect(result.returnUrl);
    return {
      status: result.status === "not_found" ? "not_available" : result.status,
    };
  } catch (error) {
    // redirect() lève une exception Next interne qu'il ne faut pas convertir.
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
