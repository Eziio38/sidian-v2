import { NextResponse } from "next/server";

import { ensurePrestataireForUser } from "@/lib/auth/ensure-prestataire";
import { evaluateAuthRateLimit } from "@/lib/auth/rate-limit";
import { resolveSafeRedirectPath } from "@/lib/auth/safe-redirect";
import { requestIdFromHeaders } from "@/lib/observability/request-id";
import { logServerEvent } from "@/lib/observability/server-logger";
import { applyAuthNoStoreHeaders } from "@/lib/supabase/auth-response";
import { createClient } from "@/lib/supabase/server";

const MAX_AUTH_CALLBACK_CODE_LENGTH = 2_048;

function authRedirect(url: URL, authResponseHeaders?: Headers) {
  const responseHeaders = new Headers(authResponseHeaders);
  applyAuthNoStoreHeaders(responseHeaders);
  responseHeaders.set("Referrer-Policy", "no-referrer");
  responseHeaders.set("X-Robots-Tag", "noindex, nofollow");

  return NextResponse.redirect(url, { headers: responseHeaders });
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextPath = resolveSafeRedirectPath(requestUrl.searchParams.get("next"));
  const origin = requestUrl.origin;
  const requestId = requestIdFromHeaders(request.headers);

  if (!code || code.length > MAX_AUTH_CALLBACK_CODE_LENGTH) {
    return authRedirect(new URL("/connexion?erreur=callback", origin));
  }

  const rateLimit = await evaluateAuthRateLimit({
    operation: "callback",
    requestHeaders: request.headers,
    identity: code,
  });
  if (rateLimit.status !== "allowed") {
    return authRedirect(new URL("/connexion?erreur=callback", origin));
  }

  const authResponseHeaders = new Headers();
  const supabase = await createClient(authResponseHeaders);
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    logServerEvent("warn", "auth.callback_failed", {
      requestId,
      stage: "exchange_code",
      errorCode: error.code ?? error.name ?? "unknown",
      status: error.status ?? null,
    });
    return authRedirect(
      new URL("/connexion?erreur=callback", origin),
      authResponseHeaders,
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email_confirmed_at) {
    return authRedirect(
      new URL("/inscription/verifier-email", origin),
      authResponseHeaders,
    );
  }

  if (nextPath !== "/reinitialiser-mot-de-passe") {
    try {
      await ensurePrestataireForUser(supabase, user);
    } catch (error) {
      logServerEvent("error", "auth.callback_failed", {
        requestId,
        stage: "ensure_prestataire",
        errorCode: error instanceof Error ? error.name : "unknown",
      });
      return authRedirect(
        new URL("/connexion?erreur=onboarding", origin),
        authResponseHeaders,
      );
    }
  }

  return authRedirect(new URL(nextPath, origin), authResponseHeaders);
}
