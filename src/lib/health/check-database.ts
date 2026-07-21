import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getApplicationEnvironment } from "@/config/env-server";
import { getSupabasePublicEnv, isSupabasePublicEnvConfigured } from "@/config/env-public";
import { assertSupabaseDeploymentEnvironment } from "@/lib/supabase/environment-attestation";
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
    if (getApplicationEnvironment() !== "local") {
      await assertSupabaseDeploymentEnvironment();
    }

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

    const { error } = await supabase.from("prestataire").select("id").limit(0);

    return error ? "unavailable" : "connected";
  } catch {
    return "unavailable";
  } finally {
    clearTimeout(timeout);
  }
}
