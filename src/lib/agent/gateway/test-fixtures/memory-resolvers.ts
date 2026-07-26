/**
 * Resolvers mémoire G1-K — zéro réseau.
 * Simule AuthPrincipalResolver + TenantMembershipResolver pour unitaires.
 */

import type {
  AuthPrincipalResolver,
  AuthenticatedPrincipal,
  ResolveMembershipInput,
  ResolveMembershipResult,
  ResolvePrincipalInput,
  ResolvePrincipalResult,
  TenantMembershipResolver,
} from "@/lib/agent/gateway";

import {
  ACTOR_ID_A,
  BEARER_TOKEN_ACTOR_DISABLED,
  BEARER_TOKEN_AUDIENCE_MISMATCH,
  BEARER_TOKEN_EXPIRED,
  BEARER_TOKEN_INVALID,
  BEARER_TOKEN_ISSUER_MISMATCH,
  BEARER_TOKEN_VALID,
  FIXED_TOKEN_EXPIRED_AT,
  FIXED_TOKEN_EXPIRES_AT,
  PRINCIPAL_SUBJECT_A,
  RAW_AUTH_PROVIDER_DETAIL,
  SESSION_ID_HASH,
  SENSITIVE_RAW_JWT,
  SENSITIVE_STACK_FRAGMENT,
  TENANT_A_UUID,
  TENANT_B_UUID,
} from "./constants";

export type MemoryMembership = {
  tenant_id: string;
  roles: readonly string[];
  status: "active" | "inactive";
};

export type MemoryPrincipalResolver = AuthPrincipalResolver & {
  resolveCalls: ResolvePrincipalInput[];
  setOutcome: (outcome: ResolvePrincipalResult | "throw") => void;
  setPrincipal: (principal: AuthenticatedPrincipal) => void;
  reset: () => void;
};

export type MemoryMembershipResolver = TenantMembershipResolver & {
  resolveCalls: ResolveMembershipInput[];
  membershipsBySubject: Map<string, MemoryMembership[]>;
  setMemberships: (
    subject: string,
    memberships: MemoryMembership[],
  ) => void;
  setNextOutcome: (outcome: ResolveMembershipResult | "throw" | null) => void;
  setThrowRaw: (raw: unknown | null) => void;
  reset: () => void;
};

export function baseAuthenticatedPrincipal(
  overrides: Partial<AuthenticatedPrincipal> = {},
): AuthenticatedPrincipal {
  return {
    principal_subject: PRINCIPAL_SUBJECT_A,
    actor_id: ACTOR_ID_A,
    actor_type: "human",
    authentication_method: "supabase_auth_jwt",
    authenticated_at: "2026-07-25T09:55:00.000Z",
    session_id_hash: SESSION_ID_HASH,
    expires_at: FIXED_TOKEN_EXPIRES_AT,
    email_confirmed: true,
    actor_disabled: false,
    ...overrides,
  };
}

/**
 * Principal resolver piloté par bearer_token (fixtures).
 * Outcome forcé via setOutcome si défini.
 */
export function createMemoryPrincipalResolver(
  initialPrincipal: AuthenticatedPrincipal = baseAuthenticatedPrincipal(),
): MemoryPrincipalResolver {
  let forced: ResolvePrincipalResult | "throw" | null = null;
  let principal = initialPrincipal;
  const resolveCalls: ResolvePrincipalInput[] = [];

  const resolver: MemoryPrincipalResolver = {
    resolveCalls,
    setOutcome(outcome) {
      forced = outcome;
    },
    setPrincipal(next) {
      principal = next;
    },
    reset() {
      forced = null;
      principal = initialPrincipal;
      resolveCalls.length = 0;
    },
    async resolvePrincipal(input) {
      resolveCalls.push(input);

      if (forced === "throw") {
        const err = new Error(RAW_AUTH_PROVIDER_DETAIL);
        err.stack = `${SENSITIVE_STACK_FRAGMENT}\n    at Object.resolvePrincipal`;
        (err as Error & { jwt?: string }).jwt = SENSITIVE_RAW_JWT;
        throw err;
      }
      if (forced !== null) {
        return forced;
      }

      if (!input.authMaterial.credential_present) {
        return { outcome: "unauthenticated" };
      }

      const token = input.authMaterial.bearer_token;
      if (token === undefined || token === "") {
        return { outcome: "unauthenticated" };
      }
      if (token === BEARER_TOKEN_INVALID) {
        return { outcome: "invalid_token" };
      }
      if (token === BEARER_TOKEN_EXPIRED) {
        return {
          outcome: "authenticated",
          principal: {
            ...principal,
            expires_at: FIXED_TOKEN_EXPIRED_AT,
          },
        };
      }
      if (token === BEARER_TOKEN_ISSUER_MISMATCH) {
        return { outcome: "issuer_mismatch" };
      }
      if (token === BEARER_TOKEN_AUDIENCE_MISMATCH) {
        return { outcome: "audience_mismatch" };
      }
      if (token === BEARER_TOKEN_ACTOR_DISABLED) {
        return {
          outcome: "authenticated",
          principal: { ...principal, actor_disabled: true },
        };
      }
      if (token !== BEARER_TOKEN_VALID) {
        return { outcome: "invalid_token" };
      }

      return {
        outcome: "authenticated",
        principal: {
          ...principal,
          ...(input.authMaterial.session_id_hash !== undefined
            ? { session_id_hash: input.authMaterial.session_id_hash }
            : {}),
        },
      };
    },
  };

  return resolver;
}

/**
 * Membership resolver mémoire — multi-tenant, inactive, missing, ambiguous.
 */
export function createMemoryMembershipResolver(
  initial: {
    subject?: string;
    memberships?: MemoryMembership[];
  } = {},
): MemoryMembershipResolver {
  const membershipsBySubject = new Map<string, MemoryMembership[]>();
  const subject = initial.subject ?? PRINCIPAL_SUBJECT_A;
  membershipsBySubject.set(
    subject,
    initial.memberships ?? [
      { tenant_id: TENANT_A_UUID, roles: ["owner"], status: "active" },
    ],
  );

  let nextOutcome: ResolveMembershipResult | "throw" | null = null;
  let throwRaw: unknown | null = null;
  const resolveCalls: ResolveMembershipInput[] = [];

  const resolver: MemoryMembershipResolver = {
    resolveCalls,
    membershipsBySubject,
    setMemberships(subj, memberships) {
      membershipsBySubject.set(subj, memberships);
    },
    setNextOutcome(outcome) {
      nextOutcome = outcome;
    },
    setThrowRaw(raw) {
      throwRaw = raw;
    },
    reset() {
      nextOutcome = null;
      throwRaw = null;
      resolveCalls.length = 0;
      membershipsBySubject.clear();
      membershipsBySubject.set(subject, [
        { tenant_id: TENANT_A_UUID, roles: ["owner"], status: "active" },
      ]);
    },
    async resolveMembership(input) {
      resolveCalls.push(input);

      if (nextOutcome === "throw") {
        if (throwRaw instanceof Error) {
          throw throwRaw;
        }
        const err = new Error(
          typeof throwRaw === "string"
            ? throwRaw
            : RAW_AUTH_PROVIDER_DETAIL,
        );
        err.stack = `${SENSITIVE_STACK_FRAGMENT}\n    at Object.resolveMembership`;
        throw err;
      }
      if (nextOutcome !== null) {
        return nextOutcome;
      }

      if (input.principal.actor_disabled === true) {
        return { outcome: "actor_disabled" };
      }

      const memberships =
        membershipsBySubject.get(input.principal.principal_subject) ?? [];

      if (memberships.length === 0) {
        return { outcome: "tenant_membership_missing" };
      }

      const requested = input.requested_tenant_id;

      if (requested !== undefined) {
        const match = memberships.find((m) => m.tenant_id === requested);
        if (!match) {
          // Hint non fiable vers un tenant hors membership → refus.
          return { outcome: "tenant_membership_missing" };
        }
        if (match.status === "inactive") {
          return { outcome: "tenant_membership_inactive" };
        }
        return {
          outcome: "resolved",
          tenant_id: match.tenant_id,
          roles: match.roles,
          membership_status: "active",
        };
      }

      const active = memberships.filter((m) => m.status === "active");
      if (active.length === 0) {
        const anyInactive = memberships.some((m) => m.status === "inactive");
        return anyInactive
          ? { outcome: "tenant_membership_inactive" }
          : { outcome: "tenant_membership_missing" };
      }
      if (active.length > 1) {
        return { outcome: "tenant_ambiguous" };
      }

      return {
        outcome: "resolved",
        tenant_id: active[0]!.tenant_id,
        roles: active[0]!.roles,
        membership_status: "active",
      };
    },
  };

  return resolver;
}

/** Multi-tenant : A + B actifs pour le même subject. */
export function multiTenantMemberships(): MemoryMembership[] {
  return [
    { tenant_id: TENANT_A_UUID, roles: ["owner"], status: "active" },
    { tenant_id: TENANT_B_UUID, roles: ["member"], status: "active" },
  ];
}
