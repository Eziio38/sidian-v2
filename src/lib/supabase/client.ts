import { createBrowserClient } from "@supabase/ssr";

import { getSupabasePublicEnv } from "@/config/env-public";

export function createClient() {
  const env = getSupabasePublicEnv();

  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
