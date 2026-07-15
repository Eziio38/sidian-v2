import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getSupabaseServerEnv } from "@/config/env-server";
import type { Database } from "@/types/database.generated";

// Usage exceptionnel uniquement : opérations serveur nécessitant explicitement la service role.
// Ne jamais utiliser ce client pour contourner la RLS par commodité.
export function createAdminClient() {
  const env = getSupabaseServerEnv();

  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
