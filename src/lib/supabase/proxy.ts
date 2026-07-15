import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabasePublicEnv } from "@/config/env-public";
import { isSupabasePublicEnvConfigured } from "@/config/env-public";

export async function updateSession(request: NextRequest) {
  const response = NextResponse.next({
    request,
  });

  if (!isSupabasePublicEnvConfigured()) {
    return response;
  }

  const env = getSupabasePublicEnv();

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
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

  await supabase.auth.getUser();

  return response;
}
