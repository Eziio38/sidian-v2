import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabasePublicEnv } from "@/config/env-public";
import { isSupabasePublicEnvConfigured } from "@/config/env-public";
import {
  applyAuthNoStoreHeaders,
  copySupabaseAuthHeaders,
  getSupabaseAuthCookieOptions,
} from "@/lib/supabase/auth-response";

function isProtectedAppPath(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/");
}

function redirectToSignIn(request: NextRequest, response: NextResponse) {
  const signInUrl = request.nextUrl.clone();
  signInUrl.pathname = "/connexion";
  signInUrl.search = "";
  signInUrl.searchParams.set("erreur", "session");

  const redirect = NextResponse.redirect(signInUrl);
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  copySupabaseAuthHeaders(response.headers, redirect.headers);
  applyAuthNoStoreHeaders(redirect.headers);

  return redirect;
}

export async function updateSession(
  request: NextRequest,
  requestHeaders: Headers = new Headers(request.headers),
) {
  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  if (!isSupabasePublicEnvConfigured()) {
    return response;
  }

  const env = getSupabasePublicEnv();

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookieOptions: getSupabaseAuthCookieOptions(),
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });

          Object.entries(headers).forEach(([key, value]) => {
            response.headers.set(key, value);
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && isProtectedAppPath(request.nextUrl.pathname)) {
    return redirectToSignIn(request, response);
  }

  return response;
}
