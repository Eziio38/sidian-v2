/**
 * Réexports fixtures d’intégration — adapters production G1-K.
 * Évite de dupliquer les chemins dans le fichier d’intégration.
 */

export { createRequestGateway } from "@/lib/agent/gateway";
export {
  createBearerScopedSupabaseClient,
  createSupabaseAuthPrincipalResolver,
  createSupabaseTenantMembershipResolver,
} from "@/lib/agent/gateway/adapters";
