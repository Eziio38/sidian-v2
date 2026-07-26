/**
 * Adaptation résultat Gateway / Router → réponse HTTP sanitizée (G1-L).
 *
 * Jamais : stack, JWT, cookie, SQL, secret, TrustedExecutionContext,
 * ToolDefinition, executor, exception brute.
 */

import type {
  GatewayErrorCode,
  GatewayResolutionDenied,
  GatewayResolutionInvalid,
} from "@/lib/agent/gateway";
import type {
  RouterErrorCode,
  ToolRouteBlocked,
  ToolRouteResult,
  ToolRouteSuccess,
} from "@/lib/agent/router";

import {
  AGENT_SERVER_SAFE_MESSAGES,
  agentServerErrorDescriptor,
  type AgentServerErrorCode,
  type AgentServerHttpStatus,
} from "./errors";
import { AGENT_SERVER_ALLOWED_METHODS } from "./request-adapter";

/** Corps HTTP canonique G1-L. */
export type AgentServerResponseBody = {
  request_id: string;
  correlation_id: string;
  status: AgentServerHttpStatus;
  code: string;
  data: Record<string, unknown>;
  degraded: {
    observability: boolean;
  };
};

export type AgentServerHttpResponse = {
  status: number;
  headers?: Record<string, string>;
  body: AgentServerResponseBody;
};

export type BuildAgentServerResponseMeta = {
  request_id: string;
  correlation_id: string;
  observability_degraded?: boolean;
};

function baseBody(
  meta: BuildAgentServerResponseMeta,
  status: AgentServerHttpStatus,
  code: string,
  data: Record<string, unknown> = {},
): AgentServerResponseBody {
  return {
    request_id: meta.request_id,
    correlation_id: meta.correlation_id,
    status,
    code,
    data,
    degraded: {
      observability: meta.observability_degraded === true,
    },
  };
}

/** Construit une `Response` Web standard depuis le contrat HTTP. */
export function toWebResponse(response: AgentServerHttpResponse): Response {
  return Response.json(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

export function buildErrorHttpResponse(
  meta: BuildAgentServerResponseMeta,
  code: AgentServerErrorCode,
  httpStatus: number,
  headers?: Record<string, string>,
): AgentServerHttpResponse {
  const descriptor = agentServerErrorDescriptor(code);
  return {
    status: httpStatus,
    ...(headers !== undefined ? { headers } : {}),
    body: baseBody(meta, "error", descriptor.code, {
      message: descriptor.message,
    }),
  };
}

export function buildMethodNotAllowedResponse(
  meta: BuildAgentServerResponseMeta,
): AgentServerHttpResponse {
  return buildErrorHttpResponse(meta, "HTTP_METHOD_NOT_ALLOWED", 405, {
    Allow: AGENT_SERVER_ALLOWED_METHODS.join(", "),
  });
}

/**
 * Mapping Gateway denied / invalid → HTTP.
 *
 * - auth absente / invalide / expirée → 401
 * - membership / tenant / acteur → 403
 * - auth indisponible → 503
 * - entrée gateway invalide → 400
 */
export function mapGatewayFailureToHttp(
  meta: BuildAgentServerResponseMeta,
  resolution: GatewayResolutionDenied | GatewayResolutionInvalid,
): AgentServerHttpResponse {
  const gatewayCode = resolution.error.code;
  const mapped = mapGatewayErrorCode(gatewayCode);
  return {
    status: mapped.httpStatus,
    body: baseBody(meta, "error", mapped.code, {
      message: AGENT_SERVER_SAFE_MESSAGES[mapped.code],
    }),
  };
}

function mapGatewayErrorCode(code: GatewayErrorCode): {
  code: AgentServerErrorCode;
  httpStatus: number;
} {
  switch (code) {
    case "AUTHENTICATION_REQUIRED":
      return { code: "AUTHENTICATION_REQUIRED", httpStatus: 401 };
    case "AUTH_TOKEN_INVALID":
    case "AUTH_TOKEN_EXPIRED":
    case "AUTH_ISSUER_MISMATCH":
    case "AUTH_AUDIENCE_MISMATCH":
      return { code: "AUTHENTICATION_INVALID", httpStatus: 401 };
    case "ACTOR_NOT_FOUND":
    case "ACTOR_DISABLED":
    case "TENANT_NOT_FOUND":
    case "TENANT_MEMBERSHIP_REQUIRED":
    case "TENANT_MEMBERSHIP_INACTIVE":
    case "TENANT_SCOPE_INVALID":
      return { code: "TENANT_ACCESS_DENIED", httpStatus: 403 };
    case "AUTH_SERVICE_UNAVAILABLE":
    case "TRUST_CONTEXT_BUILD_FAILED":
      return { code: "AGENT_DEPENDENCY_UNAVAILABLE", httpStatus: 503 };
    case "GATEWAY_INPUT_INVALID":
      return { code: "HTTP_REQUEST_INVALID", httpStatus: 400 };
    default: {
      const _exhaustive: never = code;
      void _exhaustive;
      return { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 };
    }
  }
}

/**
 * Mapping ToolRouteResult → HTTP sanitizé.
 * `data` ne contient que des champs métier déjà validés par le Router.
 */
export function mapRouterResultToHttp(
  meta: BuildAgentServerResponseMeta,
  result: ToolRouteResult,
): AgentServerHttpResponse {
  if (result.status === "success") {
    return mapSuccessToHttp(meta, result);
  }
  return mapBlockedToHttp(meta, result);
}

function mapSuccessToHttp(
  meta: BuildAgentServerResponseMeta,
  result: ToolRouteSuccess,
): AgentServerHttpResponse {
  return {
    status: 200,
    body: baseBody(
      {
        ...meta,
        correlation_id: result.correlation_id || meta.correlation_id,
        observability_degraded:
          result.observability_degraded === true ||
          meta.observability_degraded === true,
      },
      "success",
      "OK",
      {
        tool_id: result.tool_id,
        tool_version: result.tool_version,
        output: result.output,
      },
    ),
  };
}

function mapBlockedToHttp(
  meta: BuildAgentServerResponseMeta,
  result: ToolRouteBlocked,
): AgentServerHttpResponse {
  const routerCode = result.error.code;
  const mapped = mapRouterErrorCode(routerCode);
  const correlation_id =
    result.correlation_id?.trim() || meta.correlation_id;

  const data: Record<string, unknown> = {
    message: result.error.message,
  };
  if (result.tool_id !== undefined) {
    data.tool_id = result.tool_id;
  }
  if (result.tool_version !== undefined) {
    data.tool_version = result.tool_version;
  }

  return {
    status: mapped.httpStatus,
    body: baseBody(
      {
        ...meta,
        correlation_id,
        observability_degraded:
          result.observability_degraded === true ||
          meta.observability_degraded === true,
      },
      mapped.status,
      mapped.code,
      data,
    ),
  };
}

type RouterHttpMapping = {
  httpStatus: number;
  status: AgentServerHttpStatus;
  code: string;
};

function mapRouterErrorCode(code: RouterErrorCode): RouterHttpMapping {
  switch (code) {
    case "APPROVAL_REQUIRED":
    case "APPROVAL_PENDING":
    case "IDEMPOTENCY_IN_PROGRESS":
      return { httpStatus: 202, status: "pending", code };

    case "IDEMPOTENCY_KEY_CONFLICT":
    case "APPROVAL_ALREADY_CONSUMED":
      return { httpStatus: 409, status: "blocked", code };

    case "PERMISSION_DENIED":
    case "APPROVAL_NOT_FOUND":
    case "APPROVAL_REJECTED":
    case "APPROVAL_EXPIRED":
    case "APPROVAL_SCOPE_MISMATCH":
    case "APPROVAL_PARAMS_MISMATCH":
    case "APPROVAL_AUTONOMY_MISMATCH":
      return { httpStatus: 403, status: "blocked", code };

    case "TOOL_UNKNOWN":
    case "TOOL_NOT_CALLABLE":
      return { httpStatus: 404, status: "blocked", code };

    case "INVALID_ARGUMENT":
      return { httpStatus: 422, status: "blocked", code };

    case "ROUTER_INPUT_INVALID":
      return {
        httpStatus: 400,
        status: "error",
        code: "HTTP_REQUEST_INVALID",
      };

    case "IDEMPOTENCY_UNAVAILABLE":
    case "APPROVAL_UNAVAILABLE":
    case "EXECUTOR_UNAVAILABLE":
      return {
        httpStatus: 503,
        status: "error",
        code: "AGENT_DEPENDENCY_UNAVAILABLE",
      };

    case "EXECUTOR_BUSINESS_ERROR":
      return { httpStatus: 422, status: "blocked", code };

    case "IDEMPOTENCY_REPLAY_FAILURE":
      return { httpStatus: 409, status: "blocked", code };

    case "AUDIT_PERSISTENCE_FAILED":
    case "AUDIT_BUILD_FAILED":
    case "APPROVAL_CONSUMPTION_FAILED":
    case "APPROVAL_CONSUMED_EXECUTION_NOT_STARTED":
    case "EXECUTOR_TECHNICAL_ERROR":
    case "OUTPUT_SCHEMA_UNRESOLVED":
    case "INVALID_TOOL_OUTPUT":
    case "INPUT_SCHEMA_UNRESOLVED":
    case "IDEMPOTENCY_COMPLETION_FAILED":
    case "ROUTER_INTERNAL_ERROR":
      return {
        httpStatus: 500,
        status: "error",
        code: "AGENT_ROUTE_FAILED",
      };

    default: {
      const _exhaustive: never = code;
      void _exhaustive;
      return {
        httpStatus: 500,
        status: "error",
        code: "INTERNAL_SERVER_ERROR",
      };
    }
  }
}
