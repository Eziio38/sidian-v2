import { createBrowserClient } from "@supabase/ssr";

import { getSupabasePublicEnv } from "@/config/env-public";
import type { Database } from "@/types/database.generated";

export function createClient() {
  const env = getSupabasePublicEnv();

  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
