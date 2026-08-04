/**
 * Schéma strict ValidatedToolIntent + TrustedExecutionContext (G1-K).
 * Identité / grants / claims **refusés** dans l’intention — uniquement le contexte
 * de confiance produit par le Request Gateway.
 */

import { z } from "zod";

import {
  AUTHENTICATION_METHODS,
  TRUST_LEVELS,
  TRUSTED_ROLE_ALLOWLIST,
} from "@/lib/agent/gateway/types";
import {
  agentModeSchema,
  autonomyLevelSchema,
  resourceKindSchema,
} from "@/lib/agent/permissions/request-schema";

const nonEmptyString = z.string().min(1);

/**
 * Ressource métier dans l’intention — **sans** tenant_id (ancré serveur).
 */
export const validatedToolResourceSchema = z
  .object({
    kind: resourceKindSchema,
    resource_id: nonEmptyString,
  })
  .strict();

/**
 * Intention outil — données métier uniquement.
 * Champs d’identité / autorité (tenant, actor, roles, grants, claims, …)
 * refusés par `.strict()` — poison caller.
 */
export const validatedToolIntentSchema = z
  .object({
    tool_id: nonEmptyString,
    tool_version: nonEmptyString,
    mode: agentModeSchema,
    requested_autonomy_level: autonomyLevelSchema,
    arguments: z.unknown(),
    resource: validatedToolResourceSchema.optional(),
    /** Identifiant d’approbation persistée — pas de snapshot HV arbitraire. */
    approval_id: z.string().uuid().optional(),
    correlation_id: nonEmptyString.optional(),
    idempotency_key: nonEmptyString.optional(),
  })
  .strict();

/**
 * Contexte de confiance — miroir TrustedExecutionContext (gateway).
 * Remplace l’ancien ToolRouteContext `{ now }` déclaratif.
 */
export const trustedRouteContextSchema = z
  .object({
    tenant_id: z.string().uuid(),
    actor_id: nonEmptyString,
    actor_type: z.enum(["human", "system"]),
    roles: z.array(z.enum(TRUSTED_ROLE_ALLOWLIST)).min(1).max(16),
    authenticated_at: nonEmptyString.optional(),
    authentication_method: z.enum(AUTHENTICATION_METHODS),
    session_id_hash: nonEmptyString.optional(),
    principal_subject: nonEmptyString,
    trust_level: z.enum(TRUST_LEVELS),
    request_id: nonEmptyString,
    correlation_id: nonEmptyString,
    now: nonEmptyString,
  })
  .strict();

/** @deprecated Alias — préférer validatedToolIntentSchema (G1-K). */
export const toolRouteRequestSchema = validatedToolIntentSchema;

/** @deprecated Alias — préférer trustedRouteContextSchema (G1-K). */
export const toolRouteContextSchema = trustedRouteContextSchema;

/** @deprecated Anciens sous-schémas identité — plus utilisés par le Router. */
export const toolRouteActorSchema = z
  .object({
    actor_id: nonEmptyString,
    actor_type: z.enum(["human", "system"]),
  })
  .strict();

/** @deprecated */
export const toolRouteTenantSchema = z
  .object({
    tenant_id: nonEmptyString,
  })
  .strict();

export const toolRouteToolRefSchema = z
  .object({
    tool_id: nonEmptyString,
    tool_version: nonEmptyString,
  })
  .strict();

export const toolRouteIntentionSchema = z
  .object({
    mode: agentModeSchema,
    requested_autonomy_level: autonomyLevelSchema,
  })
  .strict();

export type ParsedValidatedToolIntent = z.infer<
  typeof validatedToolIntentSchema
>;
export type ParsedTrustedRouteContext = z.infer<
  typeof trustedRouteContextSchema
>;

/** Alias historiques pour compat exports. */
export type ParsedToolRouteRequest = ParsedValidatedToolIntent;
export type ParsedToolRouteContext = ParsedTrustedRouteContext;
