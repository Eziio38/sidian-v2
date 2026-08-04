/**
 * Helpers d’intégration G1-L — Gateway réelle Supabase + handler HTTP.
 * Réexporte les adapters production (comme G1-K).
 */

export { createRequestGateway } from "@/lib/agent/gateway";
export {
  createBearerScopedSupabaseClient,
  createServerRequestAuthAdapter,
  createSupabaseAuthPrincipalResolver,
  createSupabaseTenantMembershipResolver,
} from "@/lib/agent/gateway/adapters";
export { createAgentServerHandler } from "@/lib/agent/server";
