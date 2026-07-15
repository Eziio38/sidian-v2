import { NextResponse } from "next/server";

import { ensurePrestataireForUser } from "@/lib/auth/ensure-prestataire";
import { resolveSafeRedirectPath } from "@/lib/auth/safe-redirect";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextPath = resolveSafeRedirectPath(requestUrl.searchParams.get("next"));
  const origin = requestUrl.origin;

  if (!code) {
    return NextResponse.redirect(
      new URL("/connexion?erreur=callback", origin),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL("/connexion?erreur=callback", origin),
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email_confirmed_at) {
    return NextResponse.redirect(new URL("/inscription/verifier-email", origin));
  }

  if (nextPath !== "/reinitialiser-mot-de-passe") {
    try {
      await ensurePrestataireForUser(supabase, user);
    } catch {
      return NextResponse.redirect(
        new URL("/connexion?erreur=onboarding", origin),
      );
    }
  }

  return NextResponse.redirect(new URL(nextPath, origin));
}
