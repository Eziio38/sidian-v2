/**
 * Tool Router déterministe (G1-D…I + trust boundary G1-K).
 * Orchestre Registry → args → fingerprint → inspect approval → Permission →
 * claim → consume (ssi acquired + approval requise) → exécuteur → complete/fail
 * → audit → observability.
 *
 * Contrat G1-K :
 *   route(ValidatedToolIntent, TrustedExecutionContext)
 * Identité / tenant / grants **jamais** depuis l’intention — uniquement le
 * TrustedExecutionContext (Request Gateway) + `deriveGrants` serveur.
 *
 * Appelle `audit.build()` une fois avant chaque issue terminale (success / blocked)
 * dès que `context.now` est disponible ; si `auditSink` injecté, attend
 * exactement un `append` réussi avant de return (sinon AUDIT_PERSISTENCE_FAILED).
 * Si `observabilityService` injecté : exactement un `record()` **après** audit,
 * best-effort (`observability_degraded` si échec — ne transforme pas le résultat métier).
 * Aucune I/O métier directe (Stripe / Supabase / fetch / fs / Domain Service) —
 * sink, IdempotencyService, HumanApprovalService et ObservabilityService sont
 * des contrats injectés.
 * Aucune horloge implicite. Pas de retry implicite d’exécuteur.
 */

import type { ZodType } from "zod";

import {
  APPROVAL_SAFE_MESSAGES,
  buildParamsHash,
  buildRequestFingerprint,
  hashIdempotencyKey as hashApprovalIdempotencyKey,
  toTrustedHumanValidation,
  type ApprovalConsumptionBlocked,
  type ApprovalInspectionFound,
  type HumanApprovalService,
} from "@/lib/agent/approvals";
import { createAuditService } from "@/lib/agent/audit";
import type {
  AuditExecutionOutcome,
  AuditIdempotencyStatus,
} from "@/lib/agent/audit";
import {
  IDEMPOTENCY_DEFAULT_TTL_SECONDS,
  IDEMPOTENCY_SAFE_MESSAGES,
  type IdempotencyClaimDecision,
  type IdempotencyService,
  type IdempotencyTerminalResult,
} from "@/lib/agent/idempotency";
import type {
  HumanValidationRecord,
  PermissionDecision,
} from "@/lib/agent/permissions/types";
import type { ToolDefinition } from "@/lib/agent/tools/definition-schema";
import { ToolRegistryError } from "@/lib/agent/tools/errors";
import { getSchemaById } from "@/lib/agent/tools/schema-registry";
import { assertNotificationDraftPayloadMinimal } from "@/lib/agent/tools/schemas/notification-generate-draft";

import {
  buildAuditDraft,
  emitAuditOnResult,
  executorRef,
  fingerprintOpaque,
  hashIdempotencyKey,
  mapBlockedToAuditOutcome,
  unresolvedIdentity,
  type AuditEmitIdentity,
} from "./audit-emit";
import { deriveGrants } from "./derive-grants";
import { ROUTER_ERROR_CATEGORY, type RouterErrorCode } from "./error-codes";
import { asTypedExecutorFailure } from "./executor";
import { emitObservabilityOnResult } from "./observability-emit";
import {
  trustedRouteContextSchema,
  validatedToolIntentSchema,
  type ParsedTrustedRouteContext,
  type ParsedValidatedToolIntent,
} from "./request-schema";
import type {
  ToolRouteBlocked,
  ToolRouteErrorDetails,
  ToolRouteResult,
  ToolRouteSuccess,
  ToolRouter,
  ToolRouterDependencies,
  ToolRouterRegistry,
} from "./types";

function blocked(input: {
  code: RouterErrorCode;
  message: string;
  tool_id?: string;
  tool_version?: string;
  correlation_id?: string;
  details?: ToolRouteErrorDetails;
}): ToolRouteBlocked {
  const error: ToolRouteBlocked["error"] = {
    code: input.code,
    category: ROUTER_ERROR_CATEGORY[input.code],
    message: input.message,
  };
  if (input.details && Object.keys(input.details).length > 0) {
    error.details = input.details;
  }
  const result: ToolRouteBlocked = {
    status: "blocked",
    error,
  };
  if (input.tool_id !== undefined) result.tool_id = input.tool_id;
  if (input.tool_version !== undefined) {
    result.tool_version = input.tool_version;
  }
  if (input.correlation_id !== undefined) {
    result.correlation_id = input.correlation_id;
  }
  return result;
}

function success(input: {
  tool_id: string;
  tool_version: string;
  correlation_id: string;
  output: unknown;
}): ToolRouteSuccess {
  return {
    status: "success",
    tool_id: input.tool_id,
    tool_version: input.tool_version,
    correlation_id: input.correlation_id,
    output: input.output,
  };
}

function internalError(correlation_id?: string): ToolRouteBlocked {
  return blocked({
    code: "ROUTER_INTERNAL_ERROR",
    message: "Erreur interne du routeur.",
    correlation_id,
  });
}

function resolveDefinition(
  registry: ToolRouterRegistry,
  toolId: string,
  toolVersion: string,
):
  | { ok: true; definition: ToolDefinition }
  | { ok: false; code: "TOOL_UNKNOWN" | "ROUTER_INTERNAL_ERROR" } {
  try {
    const definition = registry.get(toolId, toolVersion);
    if (definition == null) {
      return { ok: false, code: "TOOL_UNKNOWN" };
    }
    return { ok: true, definition };
  } catch (error) {
    if (error instanceof ToolRegistryError) {
      if (
        error.code === "TOOL_UNKNOWN" ||
        error.code === "TOOL_VERSION_UNKNOWN"
      ) {
        return { ok: false, code: "TOOL_UNKNOWN" };
      }
    }
    return { ok: false, code: "ROUTER_INTERNAL_ERROR" };
  }
}

function resolveSchema(
  schemaId: string,
  unresolved: "INPUT_SCHEMA_UNRESOLVED" | "OUTPUT_SCHEMA_UNRESOLVED",
):
  | { ok: true; schema: ZodType }
  | {
      ok: false;
      code:
        | "INPUT_SCHEMA_UNRESOLVED"
        | "OUTPUT_SCHEMA_UNRESOLVED"
        | "ROUTER_INTERNAL_ERROR";
    } {
  try {
    return { ok: true, schema: getSchemaById(schemaId) };
  } catch (error) {
    if (
      error instanceof ToolRegistryError &&
      error.code === "SCHEMA_UNKNOWN"
    ) {
      return { ok: false, code: unresolved };
    }
    return { ok: false, code: "ROUTER_INTERNAL_ERROR" };
  }
}

function validateRouteArguments(
  definition: ToolDefinition,
  inputSchema: ZodType,
  rawArguments: unknown,
): { ok: true; arguments: unknown } | { ok: false; message: string } {
  if (
    rawArguments !== null &&
    typeof rawArguments === "object" &&
    !Array.isArray(rawArguments) &&
    Object.prototype.hasOwnProperty.call(rawArguments, "human_validation_id")
  ) {
    return {
      ok: false,
      message: "human_validation_id interdit dans arguments métier",
    };
  }

  if (definition.tool_id === "notification.generate_draft") {
    if (
      rawArguments === null ||
      typeof rawArguments !== "object" ||
      Array.isArray(rawArguments)
    ) {
      return { ok: false, message: "Un paramètre est invalide." };
    }
    try {
      assertNotificationDraftPayloadMinimal(
        rawArguments as Record<string, unknown>,
      );
    } catch {
      return {
        ok: false,
        message: "Payload notification contient des données comptables",
      };
    }
  }

  const parsed = inputSchema.safeParse(rawArguments);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const missing =
      issue?.code === "invalid_type" &&
      (issue as { received?: string }).received === "undefined";
    return {
      ok: false,
      message: missing
        ? "Un paramètre obligatoire est manquant."
        : "Un paramètre est invalide.",
    };
  }

  return { ok: true, arguments: parsed.data };
}

function mapPermissionDecision(
  decision: PermissionDecision,
  meta: {
    tool_id: string;
    tool_version: string;
    correlation_id: string;
  },
): ToolRouteBlocked | null {
  if (decision.decision === "allow") {
    return null;
  }

  if (decision.decision === "require_approval") {
    const details: ToolRouteErrorDetails = {
      permission_decision: decision.decision,
      reason_code: decision.reason_code,
    };
    if (decision.error_code) {
      details.permission_error_code = decision.error_code;
    }
    if (decision.failed_check) {
      details.failed_check = decision.failed_check;
    }
    return blocked({
      code: "APPROVAL_REQUIRED",
      message: "Une validation humaine est requise avant exécution.",
      tool_id: meta.tool_id,
      tool_version: meta.tool_version,
      correlation_id: meta.correlation_id,
      details,
    });
  }

  const details: ToolRouteErrorDetails = {
    permission_decision: decision.decision,
    reason_code: decision.reason_code,
  };
  if (decision.error_code) {
    details.permission_error_code = decision.error_code;
  }
  if (decision.failed_check) {
    details.failed_check = decision.failed_check;
  }
  return blocked({
    code: "PERMISSION_DENIED",
    message: "Permission refusée.",
    tool_id: meta.tool_id,
    tool_version: meta.tool_version,
    correlation_id: meta.correlation_id,
    details,
  });
}

function mapConsumeBlockedToRouterCode(
  outcome: ApprovalConsumptionBlocked["outcome"],
): RouterErrorCode {
  switch (outcome) {
    case "pending":
      return "APPROVAL_PENDING";
    case "rejected":
      return "APPROVAL_REJECTED";
    case "expired":
      return "APPROVAL_EXPIRED";
    case "already_consumed":
      return "APPROVAL_ALREADY_CONSUMED";
    case "scope_mismatch":
      return "APPROVAL_SCOPE_MISMATCH";
    case "params_mismatch":
      return "APPROVAL_PARAMS_MISMATCH";
    case "autonomy_mismatch":
      return "APPROVAL_AUTONOMY_MISMATCH";
    case "not_found":
      return "APPROVAL_NOT_FOUND";
    case "unavailable":
    default:
      return "APPROVAL_UNAVAILABLE";
  }
}

type IdempotencyAuditState = {
  key_hash?: string;
  status?: AuditIdempotencyStatus;
  replayed?: boolean;
  request_fingerprint?: string;
  execution_outcome: AuditExecutionOutcome;
};

type ApprovalAuditState = {
  approval_id?: string;
  approval_status?: string;
  approval_required: boolean;
  approval_consumed: boolean;
  approval_decision?: string;
  approval_failure_code?: string;
  human_validation_id?: string;
};

function identityFromTrusted(
  intent: ParsedValidatedToolIntent,
  trusted: ParsedTrustedRouteContext,
  correlationId: string,
  autonomyMaximum: 0 | 1 | 2 | 3 | null,
  idempotency: IdempotencyAuditState,
  approval: ApprovalAuditState,
  paramsHash: string | null,
): AuditEmitIdentity {
  const identity: AuditEmitIdentity = {
    correlation_id: correlationId,
    tenant_id: trusted.tenant_id,
    actor_id: trusted.actor_id,
    actor_type: trusted.actor_type,
    tool_id: intent.tool_id,
    tool_version: intent.tool_version,
    mode: intent.mode,
    autonomy_requested: intent.requested_autonomy_level,
    autonomy_maximum: autonomyMaximum,
    params_hash: paramsHash,
    execution_outcome: idempotency.execution_outcome,
    approval_required: approval.approval_required,
    approval_consumed: approval.approval_consumed,
  };
  if (intent.resource) {
    identity.resource = {
      kind: intent.resource.kind,
      resource_id: intent.resource.resource_id,
      tenant_id: trusted.tenant_id,
    };
  }
  if (approval.human_validation_id !== undefined) {
    identity.human_validation_id = approval.human_validation_id;
  }
  if (approval.approval_id !== undefined) {
    identity.approval_id = approval.approval_id;
  }
  if (approval.approval_status !== undefined) {
    identity.approval_status = approval.approval_status;
  }
  if (approval.approval_decision !== undefined) {
    identity.approval_decision = approval.approval_decision;
  }
  if (approval.approval_failure_code !== undefined) {
    identity.approval_failure_code = approval.approval_failure_code;
  }
  if (idempotency.key_hash !== undefined) {
    identity.idempotency_key_hash = idempotency.key_hash;
  }
  if (idempotency.status !== undefined) {
    identity.idempotency_status = idempotency.status;
  }
  if (idempotency.replayed !== undefined) {
    identity.replayed = idempotency.replayed;
  }
  if (idempotency.request_fingerprint !== undefined) {
    identity.request_fingerprint = idempotency.request_fingerprint;
  }
  return identity;
}

type IdempotencyLease = {
  record_id: string;
  owner_token: string;
};

function replaySuccessOutput(
  decision: Extract<IdempotencyClaimDecision, { decision: "replay_success" }>,
): unknown {
  const terminal = decision.terminal_result;
  const base: Record<string, unknown> = {
    replayed: true,
  };
  if (terminal.status === "success") {
    base.output_hash = terminal.output_hash;
    if (terminal.summary) {
      for (const [k, v] of Object.entries(terminal.summary)) {
        base[k] = v;
      }
    }
  } else {
    base.failure_code = terminal.failure_code;
    if (terminal.message !== undefined) base.message = terminal.message;
  }
  return base;
}

type RouteDeps = Required<
  Pick<
    ToolRouterDependencies,
    "registry" | "permissionService" | "executorResolver" | "auditService"
  >
> &
  Pick<
    ToolRouterDependencies,
    | "auditSink"
    | "idempotencyService"
    | "approvalService"
    | "observabilityService"
  >;

async function routeOnce(
  deps: RouteDeps,
  requestInput: unknown,
  contextInput: unknown,
): Promise<ToolRouteResult> {
  // 1. Valider TrustedExecutionContext + intention (horloge injectée)
  const contextParsed = trustedRouteContextSchema.safeParse(contextInput);
  if (!contextParsed.success) {
    return blocked({
      code: "ROUTER_INPUT_INVALID",
      message: "Contexte de confiance invalide.",
    });
  }
  const trusted: ParsedTrustedRouteContext = contextParsed.data;
  const now = trusted.now;

  const finish = async (
    result: ToolRouteResult,
    identity: AuditEmitIdentity,
    outcome: ReturnType<typeof mapBlockedToAuditOutcome> & {
      output_hash?: string;
      executor: string | null;
    },
  ): Promise<ToolRouteResult> => {
    const draft = buildAuditDraft(identity, outcome);
    const afterAudit = await emitAuditOnResult(
      deps.auditService,
      result,
      draft,
      now,
      deps.auditSink,
    );
    return emitObservabilityOnResult(
      deps.observabilityService,
      afterAudit,
      now,
    );
  };

  const requestParsed = validatedToolIntentSchema.safeParse(requestInput);
  if (!requestParsed.success) {
    const correlationId =
      trusted.correlation_id.length > 0
        ? trusted.correlation_id
        : "unresolved";
    return finish(
      blocked({
        code: "ROUTER_INPUT_INVALID",
        message: "Intention de routage invalide.",
        correlation_id: trusted.correlation_id,
      }),
      unresolvedIdentity(correlationId),
      mapBlockedToAuditOutcome("ROUTER_INPUT_INVALID"),
    );
  }
  const intent: ParsedValidatedToolIntent = requestParsed.data;

  const correlationId =
    intent.correlation_id ??
    (trusted.correlation_id.length > 0 ? trusted.correlation_id : undefined);
  if (!correlationId) {
    return finish(
      blocked({
        code: "ROUTER_INPUT_INVALID",
        message: "correlation_id obligatoire (intention ou contexte).",
      }),
      unresolvedIdentity("unresolved"),
      mapBlockedToAuditOutcome("ROUTER_INPUT_INVALID"),
    );
  }

  const toolId = intent.tool_id;
  const toolVersion = intent.tool_version;
  const meta = {
    tool_id: toolId,
    tool_version: toolVersion,
    correlation_id: correlationId,
  };

  let autonomyMaximum: 0 | 1 | 2 | 3 | null = null;
  let permissionDecision: PermissionDecision | null = null;
  let permissionAllowed = false;
  let executorInvoked = false;
  let executorId: string | null = null;
  let paramsHash: string | null = null;
  let requestFingerprint: string | null = null;
  let trustedHv: HumanValidationRecord | undefined;
  let inspection: ApprovalInspectionFound | undefined;
  let approvalConsumed = false;

  const idempotencyState: IdempotencyAuditState = {
    execution_outcome: "not_started",
  };
  if (intent.idempotency_key) {
    idempotencyState.key_hash = hashIdempotencyKey(intent.idempotency_key);
  }

  const approvalState: ApprovalAuditState = {
    approval_required: false,
    approval_consumed: false,
  };
  if (intent.approval_id) {
    approvalState.approval_id = intent.approval_id;
  }

  let lease: IdempotencyLease | null = null;

  const identity = (): AuditEmitIdentity =>
    identityFromTrusted(
      intent,
      trusted,
      correlationId,
      autonomyMaximum,
      idempotencyState,
      approvalState,
      paramsHash,
    );

  const finishBlocked = async (
    result: ToolRouteBlocked,
    code: RouterErrorCode,
  ): Promise<ToolRouteResult> => {
    const outcome = mapBlockedToAuditOutcome(code, {
      permissionDecision,
      permissionAllowed,
      executorInvoked,
    });
    if (executorInvoked && executorId) {
      outcome.executor = executorId;
    }
    return finish(result, identity(), outcome);
  };

  const markFailAndFinishBlocked = async (
    result: ToolRouteBlocked,
    code: RouterErrorCode,
    failureMessage?: string,
  ): Promise<ToolRouteResult> => {
    if (lease && deps.idempotencyService) {
      const terminal: IdempotencyTerminalResult = {
        status: "failure",
        failure_code: code,
        ...(failureMessage ? { message: failureMessage } : {}),
      };
      try {
        await deps.idempotencyService.fail({
          record_id: lease.record_id,
          owner_token: lease.owner_token,
          failure_code: code,
          terminal_result: terminal,
          now,
        });
        idempotencyState.status = "failed";
      } catch {
        idempotencyState.status = "completion_failed";
        idempotencyState.execution_outcome = executorInvoked
          ? "indeterminate"
          : "not_started";
        return finishBlocked(
          blocked({
            code: "IDEMPOTENCY_COMPLETION_FAILED",
            message: IDEMPOTENCY_SAFE_MESSAGES.IDEMPOTENCY_COMPLETION_FAILED,
            ...meta,
            details: {
              prior_error_code: code,
              executor_effect: executorInvoked ? "possible" : "none",
            },
          }),
          "IDEMPOTENCY_COMPLETION_FAILED",
        );
      }
    }
    return finishBlocked(result, code);
  };

  // 2. Résoudre ToolDefinition ; TOOL_UNKNOWN si absente
  const resolved = resolveDefinition(deps.registry, toolId, toolVersion);
  if (!resolved.ok) {
    if (resolved.code === "TOOL_UNKNOWN") {
      return finishBlocked(
        blocked({
          code: "TOOL_UNKNOWN",
          message: "Outil inconnu ou version inconnue.",
          ...meta,
        }),
        "TOOL_UNKNOWN",
      );
    }
    return finishBlocked(internalError(correlationId), "ROUTER_INTERNAL_ERROR");
  }
  const definition = resolved.definition;
  autonomyMaximum = definition.autonomy.maximum_level;
  const approvalRequired = definition.autonomy.human_validation_required;
  approvalState.approval_required = approvalRequired;

  // TOOL_NOT_CALLABLE si status != Production
  if (definition.status !== "Production") {
    return finishBlocked(
      blocked({
        code: "TOOL_NOT_CALLABLE",
        message: "Outil non callable (Production requis).",
        ...meta,
        details: { status: definition.status },
      }),
      "TOOL_NOT_CALLABLE",
    );
  }

  // 3. Résoudre schéma d’entrée + valider arguments — avant authorize / claim
  const inputSchemaResult = resolveSchema(
    definition.input_schema_id,
    "INPUT_SCHEMA_UNRESOLVED",
  );
  if (!inputSchemaResult.ok) {
    return finishBlocked(
      blocked({
        code: inputSchemaResult.code,
        message:
          inputSchemaResult.code === "INPUT_SCHEMA_UNRESOLVED"
            ? "Schéma d’entrée introuvable."
            : "Erreur interne du routeur.",
        ...meta,
      }),
      inputSchemaResult.code,
    );
  }

  const argsResult = validateRouteArguments(
    definition,
    inputSchemaResult.schema,
    intent.arguments,
  );
  if (!argsResult.ok) {
    return finishBlocked(
      blocked({
        code: "INVALID_ARGUMENT",
        message: argsResult.message,
        ...meta,
      }),
      "INVALID_ARGUMENT",
    );
  }
  const validatedArguments = argsResult.arguments;

  // Ressource de confiance : tenant ancré depuis TrustedExecutionContext
  const scopedResource = intent.resource
    ? {
        kind: intent.resource.kind,
        resource_id: intent.resource.resource_id,
        tenant_id: trusted.tenant_id,
      }
    : undefined;

  // 4. Fingerprint + params_hash (calculés — jamais de preuve déclarative appelant)
  try {
    paramsHash = buildParamsHash(validatedArguments);
    requestFingerprint = buildRequestFingerprint({
      tenant_id: trusted.tenant_id,
      tool_id: toolId,
      tool_version: toolVersion,
      mode: intent.mode,
      requested_autonomy_level: intent.requested_autonomy_level,
      arguments: validatedArguments,
      ...(scopedResource ? { resource: scopedResource } : {}),
      current_params_hash: paramsHash,
      ...(intent.approval_id
        ? { human_validation_id: intent.approval_id }
        : {}),
    });
    idempotencyState.request_fingerprint = requestFingerprint;
  } catch {
    return finishBlocked(
      blocked({
        code: "ROUTER_INTERNAL_ERROR",
        message: "Erreur interne du routeur.",
        ...meta,
      }),
      "ROUTER_INTERNAL_ERROR",
    );
  }

  // 5. Inspect approval si approval_id fourni → HV de confiance uniquement
  if (intent.approval_id) {
    const approvalService: HumanApprovalService | undefined =
      deps.approvalService;
    if (!approvalService) {
      approvalState.approval_failure_code = "APPROVAL_UNAVAILABLE";
      return finishBlocked(
        blocked({
          code: "APPROVAL_UNAVAILABLE",
          message: APPROVAL_SAFE_MESSAGES.APPROVAL_UNAVAILABLE,
          ...meta,
        }),
        "APPROVAL_UNAVAILABLE",
      );
    }

    let inspectResult;
    try {
      inspectResult = await approvalService.inspect({
        approval_id: intent.approval_id,
        tenant_id: trusted.tenant_id,
        now,
      });
    } catch {
      approvalState.approval_failure_code = "APPROVAL_UNAVAILABLE";
      return finishBlocked(
        blocked({
          code: "APPROVAL_UNAVAILABLE",
          message: APPROVAL_SAFE_MESSAGES.APPROVAL_UNAVAILABLE,
          ...meta,
        }),
        "APPROVAL_UNAVAILABLE",
      );
    }

    if (!inspectResult.found) {
      approvalState.approval_failure_code = inspectResult.code;
      const code: RouterErrorCode =
        inspectResult.code === "APPROVAL_NOT_FOUND"
          ? "APPROVAL_NOT_FOUND"
          : "APPROVAL_UNAVAILABLE";
      return finishBlocked(
        blocked({
          code,
          message: APPROVAL_SAFE_MESSAGES[inspectResult.code],
          ...meta,
        }),
        code,
      );
    }

    inspection = inspectResult;
    approvalState.approval_status = inspection.status;
    approvalState.human_validation_id = inspection.approval_id;
    if (inspection.status === "approved") {
      approvalState.approval_decision = "approve";
    } else if (inspection.status === "rejected") {
      approvalState.approval_decision = "reject";
    }
    trustedHv = toTrustedHumanValidation(inspection);
  }

  // 6. Grants dérivés serveur (jamais body) + Permission depuis TrustedExecutionContext
  const grants = deriveGrants({
    trustedContext: trusted,
    toolRef: { tool_id: toolId, tool_version: toolVersion },
    mode: intent.mode,
    required_permissions: definition.permissions.required,
    ...(scopedResource
      ? { resource_id: scopedResource.resource_id }
      : {}),
  });

  const permissionRequest = {
    actor_id: trusted.actor_id,
    actor_type: trusted.actor_type,
    tenant_id: trusted.tenant_id,
    correlation_id: correlationId,
    tool_id: toolId,
    tool_version: toolVersion,
    mode: intent.mode,
    requested_autonomy_level: intent.requested_autonomy_level,
    grants,
    ...(scopedResource ? { resource: scopedResource } : {}),
    ...(trustedHv ? { human_validation: trustedHv } : {}),
    ...(paramsHash ? { current_params_hash: paramsHash } : {}),
  };

  try {
    permissionDecision = deps.permissionService.authorize(permissionRequest, {
      now: trusted.now,
    });
  } catch {
    return finishBlocked(
      internalError(correlationId),
      "ROUTER_INTERNAL_ERROR",
    );
  }

  if (permissionDecision.autonomy.maximum != null) {
    autonomyMaximum = permissionDecision.autonomy.maximum;
  }

  // 7. deny / require_approval → stop (pas claim, pas consume, pas exécuteur)
  const permissionBlock = mapPermissionDecision(permissionDecision, meta);
  if (permissionBlock) {
    return finishBlocked(permissionBlock, permissionBlock.error.code);
  }
  permissionAllowed = true;

  // 8–9. Claim idempotence — replay/conflict/… → pas consume, pas exécuteur
  if (intent.idempotency_key) {
    const idempotencyService: IdempotencyService | undefined =
      deps.idempotencyService;
    if (!idempotencyService) {
      idempotencyState.status = "unavailable";
      return finishBlocked(
        blocked({
          code: "IDEMPOTENCY_UNAVAILABLE",
          message: IDEMPOTENCY_SAFE_MESSAGES.IDEMPOTENCY_UNAVAILABLE,
          ...meta,
        }),
        "IDEMPOTENCY_UNAVAILABLE",
      );
    }

    let claimDecision: IdempotencyClaimDecision;
    try {
      claimDecision = await idempotencyService.claim({
        tenant_id: trusted.tenant_id,
        idempotency_key: intent.idempotency_key,
        correlation_id: correlationId,
        tool_id: toolId,
        tool_version: toolVersion,
        mode: intent.mode,
        ...(scopedResource ? { resource: scopedResource } : {}),
        request_fingerprint: requestFingerprint!,
        now,
        ttl_seconds: IDEMPOTENCY_DEFAULT_TTL_SECONDS,
      });
    } catch {
      idempotencyState.status = "unavailable";
      return finishBlocked(
        blocked({
          code: "IDEMPOTENCY_UNAVAILABLE",
          message: IDEMPOTENCY_SAFE_MESSAGES.IDEMPOTENCY_UNAVAILABLE,
          ...meta,
        }),
        "IDEMPOTENCY_UNAVAILABLE",
      );
    }

    switch (claimDecision.decision) {
      case "acquired":
        lease = {
          record_id: claimDecision.record_id,
          owner_token: claimDecision.owner_token,
        };
        idempotencyState.status = "acquired";
        break;
      case "replay_success": {
        idempotencyState.status = "replay_success";
        idempotencyState.replayed = true;
        idempotencyState.execution_outcome = "replayed";
        const replayed = success({
          tool_id: toolId,
          tool_version: toolVersion,
          correlation_id: correlationId,
          output: replaySuccessOutput(claimDecision),
        });
        const outputHash =
          claimDecision.terminal_result.status === "success"
            ? claimDecision.terminal_result.output_hash
            : fingerprintOpaque(replayed.output);
        return finish(replayed, identity(), {
          decision: "allow",
          result: "success",
          reason_code: "SUCCESS",
          executor: null,
          output_hash: outputHash,
        });
      }
      case "replay_failure": {
        idempotencyState.status = "replay_failure";
        idempotencyState.replayed = true;
        idempotencyState.execution_outcome = "replayed";
        const details: ToolRouteErrorDetails = {
          idempotency_decision: "replay_failure",
        };
        if (claimDecision.failure_code) {
          details.prior_failure_code = claimDecision.failure_code;
        }
        return finishBlocked(
          blocked({
            code: "IDEMPOTENCY_REPLAY_FAILURE",
            message: IDEMPOTENCY_SAFE_MESSAGES.IDEMPOTENCY_REPLAY_FAILURE,
            ...meta,
            details,
          }),
          "IDEMPOTENCY_REPLAY_FAILURE",
        );
      }
      case "conflict":
        idempotencyState.status = "conflict";
        return finishBlocked(
          blocked({
            code: "IDEMPOTENCY_KEY_CONFLICT",
            message: IDEMPOTENCY_SAFE_MESSAGES.IDEMPOTENCY_KEY_CONFLICT,
            ...meta,
          }),
          "IDEMPOTENCY_KEY_CONFLICT",
        );
      case "in_progress": {
        idempotencyState.status = "in_progress";
        const details: ToolRouteErrorDetails = {
          idempotency_decision: "in_progress",
        };
        if (claimDecision.expires_at) {
          details.expires_at = claimDecision.expires_at;
        }
        return finishBlocked(
          blocked({
            code: "IDEMPOTENCY_IN_PROGRESS",
            message: IDEMPOTENCY_SAFE_MESSAGES.IDEMPOTENCY_IN_PROGRESS,
            ...meta,
            details,
          }),
          "IDEMPOTENCY_IN_PROGRESS",
        );
      }
      case "unavailable":
      default:
        idempotencyState.status = "unavailable";
        return finishBlocked(
          blocked({
            code: "IDEMPOTENCY_UNAVAILABLE",
            message: IDEMPOTENCY_SAFE_MESSAGES.IDEMPOTENCY_UNAVAILABLE,
            ...meta,
          }),
          "IDEMPOTENCY_UNAVAILABLE",
        );
    }
  }

  // 10. Si approval requise → consume atomique (après acquired / sans clé)
  //     Exécuteur jamais sans consume succeeded quand requise.
  if (approvalRequired) {
    if (!intent.approval_id || !deps.approvalService || !inspection) {
      approvalState.approval_failure_code = "APPROVAL_REQUIRED";
      return markFailAndFinishBlocked(
        blocked({
          code: "APPROVAL_REQUIRED",
          message: "Une validation humaine est requise avant exécution.",
          ...meta,
        }),
        "APPROVAL_REQUIRED",
      );
    }

    const idemHash = intent.idempotency_key
      ? hashApprovalIdempotencyKey(intent.idempotency_key)
      : hashApprovalIdempotencyKey(`corr:${correlationId}`);

    let consumeResult;
    try {
      consumeResult = await deps.approvalService.consume({
        approval_id: intent.approval_id,
        tenant_id: trusted.tenant_id,
        request_fingerprint: requestFingerprint!,
        params_hash: paramsHash!,
        tool_id: toolId,
        tool_version: toolVersion,
        mode: intent.mode,
        requested_autonomy_level: intent.requested_autonomy_level,
        ...(scopedResource ? { resource: scopedResource } : {}),
        correlation_id: correlationId,
        idempotency_key_hash: idemHash,
        now,
      });
    } catch {
      approvalState.approval_failure_code = "APPROVAL_CONSUMPTION_FAILED";
      return markFailAndFinishBlocked(
        blocked({
          code: "APPROVAL_CONSUMPTION_FAILED",
          message: APPROVAL_SAFE_MESSAGES.APPROVAL_CONSUMPTION_FAILED,
          ...meta,
        }),
        "APPROVAL_CONSUMPTION_FAILED",
      );
    }

    if (consumeResult.outcome !== "consumed") {
      const code = mapConsumeBlockedToRouterCode(consumeResult.outcome);
      approvalState.approval_failure_code = consumeResult.code;
      if (consumeResult.status) {
        approvalState.approval_status = consumeResult.status;
      }
      return markFailAndFinishBlocked(
        blocked({
          code,
          message:
            APPROVAL_SAFE_MESSAGES[consumeResult.code] ??
            APPROVAL_SAFE_MESSAGES.APPROVAL_CONSUMPTION_FAILED,
          ...meta,
          details: {
            approval_outcome: consumeResult.outcome,
            approval_code: consumeResult.code,
          },
        }),
        code,
      );
    }

    approvalConsumed = true;
    approvalState.approval_consumed = true;
    approvalState.approval_status = "consumed";
  }

  // 11. Résoudre exécuteur **seulement** après consume (si requise) / acquired
  let executor;
  try {
    executor = deps.executorResolver(toolId, toolVersion);
  } catch {
    if (approvalConsumed) {
      approvalState.approval_failure_code =
        "APPROVAL_CONSUMED_EXECUTION_NOT_STARTED";
      return markFailAndFinishBlocked(
        blocked({
          code: "APPROVAL_CONSUMED_EXECUTION_NOT_STARTED",
          message:
            "Approbation consommée mais exécution non démarrée (échec interne).",
          ...meta,
          details: {
            approval_consumed: true,
            note: "approval_not_reactivated",
          },
        }),
        "APPROVAL_CONSUMED_EXECUTION_NOT_STARTED",
      );
    }
    return markFailAndFinishBlocked(
      internalError(correlationId),
      "ROUTER_INTERNAL_ERROR",
    );
  }
  if (!executor) {
    if (approvalConsumed) {
      approvalState.approval_failure_code =
        "APPROVAL_CONSUMED_EXECUTION_NOT_STARTED";
      return markFailAndFinishBlocked(
        blocked({
          code: "APPROVAL_CONSUMED_EXECUTION_NOT_STARTED",
          message:
            "Approbation consommée mais exécution non démarrée (exécuteur absent).",
          ...meta,
          details: {
            approval_consumed: true,
            note: "approval_not_reactivated",
          },
        }),
        "APPROVAL_CONSUMED_EXECUTION_NOT_STARTED",
      );
    }
    return markFailAndFinishBlocked(
      blocked({
        code: "EXECUTOR_UNAVAILABLE",
        message: "Aucun exécuteur disponible pour cet outil.",
        ...meta,
      }),
      "EXECUTOR_UNAVAILABLE",
    );
  }

  executorId = executorRef(toolId, toolVersion);

  // Exécuteur une seule fois ; pas de retry implicite
  let rawOutput: unknown;
  try {
    executorInvoked = true;
    idempotencyState.execution_outcome = "executed";
    rawOutput = await executor.execute({
      arguments: validatedArguments,
      actor: { actor_id: trusted.actor_id, actor_type: trusted.actor_type },
      tenant: { tenant_id: trusted.tenant_id },
      ...(scopedResource ? { resource: scopedResource } : {}),
      correlation_id: correlationId,
    });
  } catch (error) {
    const typed = asTypedExecutorFailure(error);
    if (typed) {
      const code =
        typed.category === "business"
          ? "EXECUTOR_BUSINESS_ERROR"
          : "EXECUTOR_TECHNICAL_ERROR";
      return markFailAndFinishBlocked(
        blocked({
          code,
          message: typed.message,
          ...meta,
          details: {
            executor_code: typed.code,
            executor_category: typed.category,
          },
        }),
        code,
        typed.message,
      );
    }
    return markFailAndFinishBlocked(
      blocked({
        code: "ROUTER_INTERNAL_ERROR",
        message: "Erreur interne du routeur.",
        ...meta,
      }),
      "ROUTER_INTERNAL_ERROR",
    );
  }

  // Valider sortie schéma G1-B
  const outputSchemaResult = resolveSchema(
    definition.output_schema_id,
    "OUTPUT_SCHEMA_UNRESOLVED",
  );
  if (!outputSchemaResult.ok) {
    return markFailAndFinishBlocked(
      blocked({
        code: outputSchemaResult.code,
        message:
          outputSchemaResult.code === "OUTPUT_SCHEMA_UNRESOLVED"
            ? "Schéma de sortie introuvable."
            : "Erreur interne du routeur.",
        ...meta,
      }),
      outputSchemaResult.code,
    );
  }

  const outputParsed = outputSchemaResult.schema.safeParse(rawOutput);
  if (!outputParsed.success) {
    return markFailAndFinishBlocked(
      blocked({
        code: "INVALID_TOOL_OUTPUT",
        message: "Sortie d’outil invalide.",
        ...meta,
        details: {
          issue_count: outputParsed.error.issues.length,
        },
      }),
      "INVALID_TOOL_OUTPUT",
    );
  }

  const outputHash = fingerprintOpaque(outputParsed.data);

  // 12. complete avant return succès (si lease acquis)
  if (lease && deps.idempotencyService) {
    try {
      await deps.idempotencyService.complete({
        record_id: lease.record_id,
        owner_token: lease.owner_token,
        terminal_result: {
          status: "success",
          output_hash: outputHash,
        },
        now,
      });
      idempotencyState.status = "completed";
    } catch {
      idempotencyState.status = "completion_failed";
      idempotencyState.execution_outcome = "indeterminate";
      return finishBlocked(
        blocked({
          code: "IDEMPOTENCY_COMPLETION_FAILED",
          message: IDEMPOTENCY_SAFE_MESSAGES.IDEMPOTENCY_COMPLETION_FAILED,
          ...meta,
          details: {
            executor_effect: "possible",
            prior_status: "success",
          },
        }),
        "IDEMPOTENCY_COMPLETION_FAILED",
      );
    }
  }

  // 13–14. Auditer (+ persist si sink), retourner résultat stable
  const successResult = success({
    tool_id: toolId,
    tool_version: toolVersion,
    correlation_id: correlationId,
    output: outputParsed.data,
  });

  return finish(successResult, identity(), {
    decision: "allow",
    result: "success",
    reason_code: "SUCCESS",
    executor: executorId,
    output_hash: outputHash,
  });
}

/**
 * Crée un Tool Router déterministe à partir des dépendances injectées.
 * `auditSink` / `idempotencyService` / `approvalService` /
 * `observabilityService` optionnels — jamais de client Supabase ici.
 */
export function createToolRouter(deps: ToolRouterDependencies): ToolRouter {
  const resolvedDeps: RouteDeps = {
    registry: deps.registry,
    permissionService: deps.permissionService,
    executorResolver: deps.executorResolver,
    auditService: deps.auditService ?? createAuditService(),
    auditSink: deps.auditSink,
    idempotencyService: deps.idempotencyService,
    approvalService: deps.approvalService,
    observabilityService: deps.observabilityService,
  };

  return {
    async route(request: unknown, context: unknown): Promise<ToolRouteResult> {
      try {
        return await routeOnce(resolvedDeps, request, context);
      } catch {
        // Catch externe : tenter audit/obs minimal (identité unresolved) si
        // horloge injectée disponible — sinon return sans inventer de now.
        const contextParsed = trustedRouteContextSchema.safeParse(context);
        if (!contextParsed.success) {
          return internalError();
        }
        const now = contextParsed.data.now;
        const correlationId =
          contextParsed.data.correlation_id &&
          contextParsed.data.correlation_id.length > 0
            ? contextParsed.data.correlation_id
            : "unresolved";
        const result = internalError(correlationId);
        const draft = buildAuditDraft(
          unresolvedIdentity(correlationId),
          mapBlockedToAuditOutcome("ROUTER_INTERNAL_ERROR"),
        );
        const afterAudit = await emitAuditOnResult(
          resolvedDeps.auditService,
          result,
          draft,
          now,
          resolvedDeps.auditSink,
        );
        return emitObservabilityOnResult(
          resolvedDeps.observabilityService,
          afterAudit,
          now,
        );
      }
    },
  };
}
