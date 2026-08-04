import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getSupabasePublicEnv } from "@/config/env-public";
import {
  copySupabaseAuthHeaders,
  getSupabaseAuthCookieOptions,
} from "@/lib/supabase/auth-response";
import { assertSupabaseDeploymentEnvironment } from "@/lib/supabase/environment-attestation";
import type { Database } from "@/types/database.generated";

export async function createClient(authResponseHeaders?: Headers) {
  await assertSupabaseDeploymentEnvironment();
  const cookieStore = await cookies();
  const env = getSupabasePublicEnv();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookieOptions: getSupabaseAuthCookieOptions(),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet, headersToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
            if (authResponseHeaders) {
              copySupabaseAuthHeaders(headersToSet, authResponseHeaders);
            }
          } catch {
            // Server Components en lecture seule : le rafraîchissement est géré par proxy.ts.
          }
        },
      },
    },
  );
}
