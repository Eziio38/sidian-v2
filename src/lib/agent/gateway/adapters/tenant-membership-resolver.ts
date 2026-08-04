/**
 * TenantMembershipResolver — appartenance tenant = `prestataire` (EPICU V1).
 *
 * Modèle réel du dépôt :
 * - tenant_id ≡ `prestataire.id`
 * - membership ≡ ligne `prestataire` où `user_id` = `auth.uid()` / principal
 * - pas de table membership multi-org encore ; le resolver reste multi-tenant ready
 *   (plusieurs lignes → sélection via hint header vérifié)
 *
 * ## service_role
 * Aucun usage. Lecture via client utilisateur injecté + RLS
 * (`prestataire.user_id = auth.uid()`). Ne jamais résoudre la membership
 * avec un client admin qui contournerait RLS.
 */

import type {
  AuthenticatedPrincipal,
  ResolveMembershipInput,
  ResolveMembershipResult,
  TenantMembershipResolver,
  TrustedRole,
} from "@/lib/agent/gateway/types";

import {
  ACTIVE_SUBSCRIPTION_STATUSES,
  INACTIVE_SUBSCRIPTION_STATUS,
} from "./constants";
import type { GatewayUserSupabaseClient } from "./user-scoped-client";

type PrestataireMembershipRow = {
  id: string;
  user_id: string;
  subscription_status: string;
};

const ACTIVE_SET = new Set<string>(ACTIVE_SUBSCRIPTION_STATUSES);

export type SupabaseTenantMembershipResolverDeps = {
  /**
   * Client utilisateur injecté — **jamais** service_role.
   * Doit être authentifié comme le principal (cookie ou Bearer).
   */
  supabase: GatewayUserSupabaseClient;
};

function isActiveSubscription(status: string): boolean {
  return ACTIVE_SET.has(status);
}

function membershipRoleForSoloOwner(): TrustedRole[] {
  // EPICU V1 : le propriétaire du prestataire est `owner`.
  return ["owner"];
}

function classifyPrincipalGate(
  principal: AuthenticatedPrincipal,
): ResolveMembershipResult | null {
  if (principal.actor_disabled === true) {
    return { outcome: "actor_disabled" };
  }
  if (principal.email_confirmed === false) {
    return { outcome: "actor_disabled" };
  }
  return null;
}

/**
 * Implémentation TenantMembershipResolver basée sur `public.prestataire`.
 */
export class SupabaseTenantMembershipResolver
  implements TenantMembershipResolver
{
  private readonly supabase: GatewayUserSupabaseClient;

  constructor(deps: SupabaseTenantMembershipResolverDeps) {
    this.supabase = deps.supabase;
  }

  async resolveMembership(
    input: ResolveMembershipInput,
  ): Promise<ResolveMembershipResult> {
    const gated = classifyPrincipalGate(input.principal);
    if (gated) {
      return gated;
    }

    const subject = input.principal.principal_subject;
    if (!subject) {
      return { outcome: "tenant_membership_missing" };
    }

    let rows: PrestataireMembershipRow[];
    try {
      const { data, error } = await this.supabase
        .from("prestataire")
        .select("id, user_id, subscription_status")
        .eq("user_id", subject);

      if (error) {
        return { outcome: "unavailable" };
      }

      rows = (data ?? []) as PrestataireMembershipRow[];
    } catch {
      return { outcome: "unavailable" };
    }

    // Défense : ignorer toute ligne dont user_id ≠ principal (ne devrait
    // pas arriver sous RLS user ; protège contre un mauvais client injecté).
    const owned = rows.filter((row) => row.user_id === subject);
    if (owned.length === 0) {
      return { outcome: "tenant_membership_missing" };
    }

    const requested = input.requested_tenant_id?.trim();

    if (requested) {
      const match = owned.find((row) => row.id === requested);
      if (!match) {
        // Tenant arbitraire / inconnu pour ce principal — pas de confiance
        // dans le header/param.
        return { outcome: "tenant_not_found" };
      }
      if (match.subscription_status === INACTIVE_SUBSCRIPTION_STATUS) {
        return { outcome: "tenant_membership_inactive" };
      }
      if (!isActiveSubscription(match.subscription_status)) {
        return { outcome: "tenant_membership_inactive" };
      }
      return {
        outcome: "resolved",
        tenant_id: match.id,
        roles: membershipRoleForSoloOwner(),
        membership_status: "active",
      };
    }

    const active = owned.filter((row) =>
      isActiveSubscription(row.subscription_status),
    );

    if (active.length === 0) {
      // Des memberships existent mais toutes inactives.
      return { outcome: "tenant_membership_inactive" };
    }

    if (active.length > 1) {
      // Multi-tenant sans hint → ambigu (appelant doit fournir le header).
      return { outcome: "tenant_ambiguous" };
    }

    const sole = active[0]!;
    return {
      outcome: "resolved",
      tenant_id: sole.id,
      roles: membershipRoleForSoloOwner(),
      membership_status: "active",
    };
  }
}

export function createSupabaseTenantMembershipResolver(
  deps: SupabaseTenantMembershipResolverDeps,
): TenantMembershipResolver {
  return new SupabaseTenantMembershipResolver(deps);
}
