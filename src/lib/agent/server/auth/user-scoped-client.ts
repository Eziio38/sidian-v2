/**
 * Client Supabase **utilisateur** pour le point d’entrée HTTP agent (G1-L).
 *
 * Sources autorisées (jamais le body JSON) :
 * - `Authorization: Bearer <JWT utilisateur>` → anon + Bearer ;
 * - cookies session Supabase SSR → `createClient` (`@/lib/supabase/server`).
 *
 * **service_role interdit** — voir `service-role.ts` pour la persistance seule.
 */

import "server-only";

import {
  createBearerScopedSupabaseClient,
  type GatewayUserSupabaseClient,
} from "@/lib/agent/gateway/adapters";
import type { AuthMaterial } from "@/lib/agent/gateway/types";
import { getSupabasePublicEnv } from "@/config/env-public";
import { createClient as createCookieServerClient } from "@/lib/supabase/server";
import { createClient as createAnonClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.generated";

export type UserScopedClientKind = "bearer" | "cookie_session" | "anonymous";

export type ResolvedUserScopedClient = {
  supabase: GatewayUserSupabaseClient;
  kind: UserScopedClientKind;
  supabaseUrl: string;
};

/**
 * Résout le client utilisateur depuis AuthMaterial déjà extrait des headers/cookies.
 * Aucune lecture de body ; aucun JWT inventé.
 */
export async function resolveUserScopedSupabaseClient(
  authMaterial: AuthMaterial,
): Promise<ResolvedUserScopedClient> {
  const env = getSupabasePublicEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const bearer = authMaterial.bearer_token?.trim();
  if (bearer) {
    return {
      supabase: createBearerScopedSupabaseClient({
        supabaseUrl,
        anonKey,
        accessToken: bearer,
      }),
      kind: "bearer",
      supabaseUrl,
    };
  }

  if (authMaterial.credential_present) {
    // Session cookie SSR — `cookies()` Next lit la requête courante.
    const supabase = await createCookieServerClient();
    return {
      supabase,
      kind: "cookie_session",
      supabaseUrl,
    };
  }

  // Credential absent : Gateway short-circuit avant resolvers.
  // Client anon placeholder — ne représente personne.
  return {
    supabase: createAnonClient<Database>(supabaseUrl, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    }),
    kind: "anonymous",
    supabaseUrl,
  };
}
