/**
 * Documentation et accès **service_role** pour la persistance agent (G1-F/G/H).
 *
 * ## Règles non négociables
 *
 * | Opération | Client | Pourquoi |
 * |---|---|---|
 * | Auth principal (`getUser`) | **user** (cookie SSR / Bearer anon) | Jamais service_role comme session |
 * | Membership `prestataire` | **user** + RLS | Contournement RLS interdit |
 * | Insert audit (`agent_audit_events`) | **service_role** | Grants SQL ; `tenant_id` = TrustedExecutionContext uniquement |
 * | RPC idempotency | **service_role** | `p_tenant_id` trusted ; RPC vérifie prestataire |
 * | RPC approvals | **service_role** | Idem — SECURITY DEFINER + guards |
 * | RPC protection drafts (G1-M) | **service_role** | `p_tenant_id` trusted ; confirm atomique |
 *
 * Le service_role **bypass RLS PostgREST** mais :
 * 1. l’identité trusted est imposée avant write par Gateway → Router ;
 * 2. les RPC G/H scopent par `p_tenant_id` + existence prestataire ;
 * 3. ce module ne présente **jamais** service_role comme session utilisateur ;
 * 4. le body HTTP ne peut pas choisir le tenant écrit (intention sans identité).
 *
 * @see `src/lib/agent/gateway/adapters/index.ts` — interdiction service_role côté auth
 * @see `docs/implementation/SID_GATE_G1K_EVIDENCE.md` — modèle de confiance
 */

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database.generated";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Client admin réservé aux writes agent (audit / idempotency / approvals).
 * **Ne pas** utiliser pour représenter l’appelant ni résoudre la membership.
 */
export type AgentPersistenceSupabaseClient = SupabaseClient<Database>;

/**
 * Crée le client service_role pour la persistance agent uniquement.
 * Échoue fail-closed si l’environnement Supabase n’est pas attesté.
 */
export async function createAgentPersistenceClient(): Promise<AgentPersistenceSupabaseClient> {
  return createAdminClient();
}
