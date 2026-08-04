/**
 * Client Supabase **utilisateur** pour les adapters gateway G1-K.
 *
 * ## service_role — INTERDIT ici
 *
 * Ces helpers n’utilisent **jamais** `SUPABASE_SERVICE_ROLE_KEY` /
 * `createAdminClient`. Un client service_role ne doit pas représenter
 * l’utilisateur final pour la résolution JWT → principal → membership
 * ni pour les lectures RLS `prestataire`.
 *
 * Usage autorisé :
 * - client cookie SSR (`createClient` de `@/lib/supabase/server`) ;
 * - client anon + `Authorization: Bearer <access_token utilisateur>`
 *   via `createBearerScopedSupabaseClient`.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.generated";

export type GatewayUserSupabaseClient = SupabaseClient<Database>;

export type CreateBearerScopedSupabaseClientParams = {
  supabaseUrl: string;
  /** Clé **anon** uniquement — jamais service_role. */
  anonKey: string;
  /** Access token utilisateur (Bearer) déjà extrait hors body. */
  accessToken: string;
};

/**
 * Client PostgREST scopé à l’utilisateur via Bearer JWT.
 * La clé est l’anon key ; le JWT utilisateur porte l’identité RLS (`auth.uid()`).
 *
 * @remarks **Pas de service_role.** Le Bearer doit être un JWT `authenticated`,
 * pas un JWT technique.
 */
export function createBearerScopedSupabaseClient(
  params: CreateBearerScopedSupabaseClientParams,
): GatewayUserSupabaseClient {
  const accessToken = params.accessToken.trim();
  if (!accessToken) {
    throw new Error("gateway_bearer_token_missing");
  }

  return createClient<Database>(params.supabaseUrl, params.anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}
