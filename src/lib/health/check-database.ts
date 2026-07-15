import "server-only";

import { isSupabasePublicEnvConfigured } from "@/config/env-public";
import { isSupabaseServerEnvConfigured } from "@/config/env-server";
import { createAdminClient } from "@/lib/supabase/admin";

export type DatabaseHealthStatus =
  | "connected"
  | "not_configured"
  | "unavailable";

export async function checkDatabaseHealth(): Promise<DatabaseHealthStatus> {
  if (
    !isSupabasePublicEnvConfigured() ||
    !isSupabaseServerEnvConfigured()
  ) {
    return "not_configured";
  }

  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("_sidian_health_probe")
      .select("id")
      .limit(1);

    if (!error) {
      return "connected";
    }

    if (error.code === "PGRST205" || error.code === "PGRST116") {
      return "connected";
    }

    return "unavailable";
  } catch {
    return "unavailable";
  }
}
