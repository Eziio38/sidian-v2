/**
 * Câblage RequestGateway avec resolvers Supabase user-scopés (G1-L).
 *
 * Le client injecté doit être l’identité de l’appelant (cookie ou Bearer).
 * Aucun service_role ici.
 */

import "server-only";

import { createRequestGateway, type RequestGateway } from "@/lib/agent/gateway";
import {
  createSupabaseAuthPrincipalResolver,
  createSupabaseTenantMembershipResolver,
  type GatewayUserSupabaseClient,
} from "@/lib/agent/gateway/adapters";

export type CreateAgentHttpGatewayParams = {
  /** Client utilisateur (cookie SSR ou Bearer anon) — jamais admin. */
  supabase: GatewayUserSupabaseClient;
  /** URL publique Supabase — issuer JWT attendu. */
  supabaseUrl: string;
};

/**
 * Gateway par requête : principal + membership liés au client user courant.
 */
export function createAgentHttpGateway(
  params: CreateAgentHttpGatewayParams,
): RequestGateway {
  const principalResolver = createSupabaseAuthPrincipalResolver({
    supabase: params.supabase,
    supabaseUrl: params.supabaseUrl,
  });
  const membershipResolver = createSupabaseTenantMembershipResolver({
    supabase: params.supabase,
  });

  return createRequestGateway({
    principalResolver,
    membershipResolver,
  });
}
