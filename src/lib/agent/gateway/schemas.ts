/**
 * Schémas Zod stricts du Request Gateway (G1-K).
 * Refuse champs de confiance, secrets, JWT et clés inconnues.
 */

import { z } from "zod";

import {
  actorTypeSchema,
  agentModeSchema,
  autonomyLevelSchema,
  resourceKindSchema,
} from "@/lib/agent/permissions/request-schema";

import {
  AUTHENTICATION_METHODS,
  TRUST_LEVELS,
  TRUSTED_ROLE_ALLOWLIST,
} from "./types";

const nonEmptyString = z.string().min(1);
const isoTimestampSchema = nonEmptyString.max(64);
const hashSchema = nonEmptyString.max(128);

/**
 * Ressource externe — **sans** `tenant_id` (ancrage serveur uniquement).
 * Un `tenant_id` ici est rejeté par `.strict()`.
 */
export const externalToolResourceSchema = z
  .object({
    kind: resourceKindSchema,
    resource_id: nonEmptyString.max(256),
  })
  .strict();

/**
 * Corps outil externe — données métier uniquement.
 * Champs interdits (tenant_id, actor_id, roles, permissions, grants,
 * tool_definition, executor, human_validation, …) → échec `.strict()`.
 */
export const externalToolRequestSchema = z
  .object({
    tool_id: nonEmptyString.max(128),
    tool_version: nonEmptyString.max(64),
    mode: agentModeSchema,
    requested_autonomy_level: autonomyLevelSchema,
    arguments: z.unknown(),
    resource: externalToolResourceSchema.optional(),
    idempotency_key: nonEmptyString.max(256).optional(),
    approval_id: z.string().uuid().optional(),
    correlation_id: nonEmptyString.max(256).optional(),
  })
  .strict();

/**
 * Matériel auth adapter serveur.
 * `bearer_token` reste hors TrustedExecutionContext (jamais recopié).
 */
export const authMaterialSchema = z
  .object({
    credential_present: z.boolean(),
    bearer_token: nonEmptyString.max(8192).optional(),
    session_id_hash: hashSchema.optional(),
  })
  .strict();

export const gatewayRequestMetadataSchema = z
  .object({
    request_id: nonEmptyString.max(128),
    correlation_id: nonEmptyString.max(256).optional(),
    /** Hint non fiable — vérifié contre memberships. */
    requested_tenant_id: z.string().uuid().optional(),
  })
  .strict();

export const gatewayRequestSchema = z
  .object({
    externalRequest: externalToolRequestSchema,
    authMaterial: authMaterialSchema,
    requestMetadata: gatewayRequestMetadataSchema,
    now: isoTimestampSchema,
  })
  .strict();

export const authenticationMethodSchema = z.enum(AUTHENTICATION_METHODS);

export const trustedRoleSchema = z.enum(TRUSTED_ROLE_ALLOWLIST);

export const trustLevelSchema = z.enum(TRUST_LEVELS);

/**
 * Principal authentifié — schéma de validation post-resolver.
 * Interdit JWT / tokens / claims bruts via `.strict()`.
 */
export const authenticatedPrincipalSchema = z
  .object({
    principal_subject: nonEmptyString.max(256),
    actor_id: nonEmptyString.max(256),
    actor_type: actorTypeSchema,
    authentication_method: authenticationMethodSchema,
    authenticated_at: isoTimestampSchema.optional(),
    session_id_hash: hashSchema.optional(),
    expires_at: isoTimestampSchema.optional(),
    email_confirmed: z.boolean().optional(),
    actor_disabled: z.boolean().optional(),
  })
  .strict();

/**
 * Contexte de confiance — jamais JWT / access_token / refresh_token / claims.
 */
export const trustedExecutionContextSchema = z
  .object({
    tenant_id: z.string().uuid(),
    actor_id: nonEmptyString.max(256),
    actor_type: actorTypeSchema,
    roles: z.array(trustedRoleSchema).max(16),
    authenticated_at: isoTimestampSchema.optional(),
    authentication_method: authenticationMethodSchema,
    session_id_hash: hashSchema.optional(),
    principal_subject: nonEmptyString.max(256),
    trust_level: trustLevelSchema,
    request_id: nonEmptyString.max(128),
    correlation_id: nonEmptyString.max(256),
    now: isoTimestampSchema,
  })
  .strict();

export type ParsedExternalToolRequest = z.infer<
  typeof externalToolRequestSchema
>;
export type ParsedAuthMaterial = z.infer<typeof authMaterialSchema>;
export type ParsedGatewayRequestMetadata = z.infer<
  typeof gatewayRequestMetadataSchema
>;
export type ParsedGatewayRequest = z.infer<typeof gatewayRequestSchema>;
export type ParsedAuthenticatedPrincipal = z.infer<
  typeof authenticatedPrincipalSchema
>;
export type ParsedTrustedExecutionContext = z.infer<
  typeof trustedExecutionContextSchema
>;
