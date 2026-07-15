import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getSupabasePublicEnv, isSupabasePublicEnvConfigured } from "@/config/env-public";
import type { Database } from "@/types/database.generated";

const HEALTH_CHECK_TIMEOUT_MS = 5_000;

export type DatabaseHealthStatus =
  | "connected"
  | "not_configured"
  | "unavailable";

export async function checkDatabaseHealth(): Promise<DatabaseHealthStatus> {
  if (!isSupabasePublicEnvConfigured()) {
    return "not_configured";
  }

  const env = getSupabasePublicEnv();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

  try {
    const supabase = createClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        auth: { autoRefreshToken: false, persistSession: false },
        global: {
          fetch: (url, init) =>
            fetch(url, { ...init, signal: controller.signal }),
        },
      },
    );

    const { error } = await supabase.from("prestataire").select("id").limit(1);

    if (error?.code === "PGRST205") {
      return "unavailable";
    }

    if (error) {
      return "unavailable";
    }

    return "connected";
  } catch {
    return "unavailable";
  } finally {
    clearTimeout(timeout);
  }
}
